import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installDiagnosticApi } from '../src/diagnostic.js';
import { getLastMessageId as resolveLastMessageId } from '../src/host-context.js';
import { installTodayTrend } from '../src/today-trend.js';
import { createTodayTrendPhoneController } from '../src/today-trend-phone-controller.js';
import { installTodayTrendPhoneUi } from '../src/today-trend-phone-ui.js';
import { PHONE_UI_PAGES } from '../src/interactive-scene-model.js';
import { renderPhoneDesktop } from '../src/interactive-scene-views.js';
import {
    advanceTodayTrendEvent, appendTodayTrendGenerationSnapshot, archiveTodayTrendEvent, copyTodayTrendScope, createEmptyTodayTrendStore,
    createDefaultTodayTrendDynamicsSettings, promoteTodayTrendUnderground, settleTodayTrendRumor, TODAY_TREND_EVENT_LIFECYCLES, TODAY_TREND_EVENT_OUTCOMES,
    TODAY_TREND_EVENT_TYPES, TODAY_TREND_LIMITS, TODAY_TREND_OPERATION_MODES, TODAY_TREND_RELATION_STATUSES, TODAY_TREND_STATUS_LABELS,
    TODAY_TREND_VERSION, migrateTodayTrendStore, normalizeTodayTrendStore, rollbackTodayTrendScope,
    todayTrendStatusLabel,
} from '../src/today-trend-model.js';
import { createTodayTrendStorage } from '../src/today-trend-storage.js';
import {
    createTodayTrendV2Authority, createTodayTrendV2Envelope, normalizeTodayTrendMigrationBackup,
    normalizeTodayTrendV2Authority, normalizeTodayTrendV2Envelope,
} from '../src/today-trend-v2-authority.js';
import {
    applyTodayTrendGenerationToV2, applyTodayTrendRerollToV2, buildReadOnlyShadow, diffReadOnlyShadow, evaluateTodayTrendArchivedRetention,
    copyTodayTrendV2ScopeForBranch, describeTodayTrendLegacyBatchBaselineEligibility, extractArchivedFixedCore, migrateTodayTrendStoreToV2,
    normalizeTodayTrendStageProjection, normalizeTodayTrendV2Candidate, normalizeTodayTrendV2Store,
    resolveTodayTrendV2DetailForTarget, resolveTodayTrendV2LatestStage, resolveTodayTrendV2RetentionSettingsState,
    resolveTodayTrendV2UiScope, rollbackTodayTrendV2Scope, saveTodayTrendRetentionSettingsToV2, serializeTodayTrendV2ScopeForGeneration,
    replaceTodayTrendV2ScopeWithBatchReset, replaceTodayTrendV2ScopeWithInitialization, validateTodayTrendV2Transition,
} from '../src/today-trend-v2-model.js';
import {
    appendTodayTrendCanonicalSnapshot, applyTodayTrendHistoryProducer, normalizeTodayTrendHistoryProducer,
} from '../src/today-trend-history-reducer.js';
import { createTodayTrendCommitter } from '../src/today-trend-commit.js';
import { createTodayTrendJournal, normalizeTodayTrendJournal, todayTrendStoreDigest } from '../src/today-trend-journal.js';
import { createPhoneInjectionController } from '../src/phone-injection-controller.js';
import {
    TODAY_TREND_V1_MIGRATION_BACKUP_KEY, TODAY_TREND_V2_AUTHORITY_KEY, TODAY_TREND_V2_FALLBACK_KEY,
    TODAY_TREND_V2_JOURNAL_PREFIX, TODAY_TREND_V2_STORAGE_KEY,
} from '../src/constants.js';
import { pmIDBCompareAndSwap } from '../src/pm-idb.js';
import { gatherTodayTrendContext } from '../src/today-trend-context.js';
import {
    buildTodayTrendGenerationEnvelope,
    buildTodayTrendInitializationEnvelope,
    buildTodayTrendRuleRegenerationEnvelope,
} from '../src/today-trend-prompts.js';
import {
    buildTodayTrendGenerationEnvelope as buildCanonicalTodayTrendGenerationEnvelope,
    buildTodayTrendInitializationEnvelope as buildCanonicalTodayTrendInitializationEnvelope,
    buildTodayTrendRuleRegenerationEnvelope as buildCanonicalTodayTrendRuleRegenerationEnvelope,
} from '../src/prompts/today-trend/envelopes.js';
import { createTodayTrendGenerationController } from '../src/today-trend-generation.js';
import {
    buildTodayTrendHistoryBatch, countTodayTrendAssistantMessages, createTodayTrendScheduler as createTodayTrendSchedulerBase, planTodayTrendHistoryBatches,
} from '../src/today-trend-scheduler.js';
import { createPhoneHostEventController } from '../src/phone-host-events.js';
import { renderTodayTrendInjection } from '../src/today-trend-injection.js';
import { renderTodayTrendApp } from '../src/today-trend-view.js';
import { renderTodayTrendWorldView } from '../src/today-trend-world-view.js';
import { renderTodayTrendReputationView } from '../src/today-trend-reputation-view.js';
import { renderTodayTrendFactionView } from '../src/today-trend-faction-view.js';
import { renderTodayTrendDynamicsView } from '../src/today-trend-dynamics-view.js';
import { renderTodayTrendSettingsView } from '../src/today-trend-settings-view.js';
import { createTodayTrendActionDispatcher } from '../src/today-trend-actions.js';
import { TODAY_TREND_RELATION_ICON_PATHS } from '../src/icons.js';
import { TODAY_TREND_TITLE_ICON_TOPICS, todayTrendTitleNamingGuide } from '../src/today-trend-title-icon-topics.js';
import { resolveTodayTrendTitleIcon } from '../src/today-trend-title-icon-mapping.js';
import { trendActionMenu, trendInlineActions, trendRuleEditor } from '../src/today-trend-ui.js';
import {
    createFaultSchedule,
    createSeededRandom,
    createTodayTrendV1Fixture,
    normalizeDeterministicSeed,
    runDeterministicSequence,
} from './today-trend-test-foundation.mjs';

const originalTavernHelper = globalThis.TavernHelper;
try {
    globalThis.TavernHelper = { getLastMessageId: () => 3402 };
    assert.equal(resolveLastMessageId(() => ({ chat: [{ message_id: 1 }] })), 3402, '当前楼层必须优先读取 TavernHelper.getLastMessageId');
    globalThis.TavernHelper = undefined;
    assert.equal(resolveLastMessageId(() => ({ chat: [{ message_id: 2 }, { message_id: 3000 }] })), 3000, '缺少 TavernHelper 时必须读取酒馆聊天末消息的 message_id');
    assert.equal(resolveLastMessageId(() => ({ chat: [{}, {}, {}] })), 2, '末消息缺少 message_id 时必须按酒馆零基楼层使用 chat.length - 1');
    assert.equal(resolveLastMessageId(() => ({ chat: [] })), 0, '空聊天必须稳定返回酒馆起始楼层 0');
    assert.equal(resolveLastMessageId(() => null), null, '宿主上下文不可用时必须返回 null');
} finally {
    if (originalTavernHelper === undefined) delete globalThis.TavernHelper;
    else globalThis.TavernHelper = originalTavernHelper;
}

const createTodayTrendScheduler = options => createTodayTrendSchedulerBase({ commitFeedbackMs: 0, ...options });

const historyWindowMessages = [
    { role: 'user', content: '用户一' }, { role: 'assistant', content: '助手一' },
    { role: 'user', content: '用户二' }, { role: 'assistant', content: '助手二' },
    { role: 'user', content: '用户三' }, { role: 'assistant', content: '助手三' },
    { role: 'user', content: '用户四' }, { role: 'assistant', content: '助手四' },
    { role: 'user', content: '用户五' }, { role: 'assistant', content: '助手五' },
];
assert.equal(countTodayTrendAssistantMessages([
    { mes: '用户消息', is_user: true }, { mes: '宿主助手消息' },
    { role: 'assistant', content: '标准助手消息' }, { mes: '隐藏但仍是 AI 楼层', is_system: true },
    { role: 'system', content: '非 narrator 的 system 角色仍按数据库口径计入' },
    { mes: '旁白消息', extra: { type: 'narrator' } },
]), 5, 'Today Trend UI assistantCount 必须采用数据库 AI 楼层口径：所有 !is_user 消息均计入 AI 楼层');
const historyPlan = planTodayTrendHistoryBatches({ messages: historyWindowMessages, recentAssistantCount: 4, mergeAssistantCount: 3 });
assert.deepEqual({
    assistantCount: historyPlan.assistantCount, windowStart: historyPlan.windowStart, windowEnd: historyPlan.windowEnd,
    batchCount: historyPlan.batchCount, batches: historyPlan.batches,
}, {
    assistantCount: 5, windowStart: 2, windowEnd: 5, batchCount: 2,
    batches: [
        { index: 0, assistantStart: 2, assistantEnd: 4 },
        { index: 1, assistantStart: 5, assistantEnd: 5 },
    ],
}, '历史正文规划必须按真实 assistantCount 计算闭合窗口和最后短批');
assert.equal(Object.hasOwn(historyPlan, 'messages'), false, '批次规划不得预构造或常驻正文窗口');
assert.equal(typeof historyPlan.sourceDigest, 'string', '批次规划必须绑定消息源摘要');
assert.deepEqual(Object.keys(historyPlan.batches[0]).sort(), ['assistantEnd', 'assistantStart', 'index'],
    '批次描述只能保留标量边界');
assert.deepEqual(buildTodayTrendHistoryBatch(historyWindowMessages, historyPlan, 0), [
    { role: 'user', content: '用户二' }, { role: 'assistant', content: '助手二' },
    { role: 'user', content: '用户三' }, { role: 'assistant', content: '助手三' },
    { role: 'user', content: '用户四' }, { role: 'assistant', content: '助手四' },
], '历史批次必须保持原始顺序、角色和消息边界');
assert.deepEqual(buildTodayTrendHistoryBatch(historyWindowMessages, historyPlan, 1), [
    { role: 'user', content: '用户五' }, { role: 'assistant', content: '助手五' },
], '最后短批必须只包含其 assistant 范围及对应上下文');
const changedHistoryMessages = historyWindowMessages.map(message => ({ ...message }));
changedHistoryMessages[3].content = '迟到修改';
assert.throws(() => buildTodayTrendHistoryBatch(changedHistoryMessages, historyPlan, 0),
    error => error?.code === 'TT_HISTORY_WINDOW_INVALID', '消息源变化后不得复用旧批次规划');
for (const invalidPlan of [
    null,
    { ...historyPlan, batchCount: 1 },
    { ...historyPlan, sourceDigest: '' },
    { ...historyPlan, batches: [{ index: 0, assistantStart: 2, assistantEnd: 4, content: '不得携带正文' }, historyPlan.batches[1]] },
    { ...historyPlan, batches: [{ index: 0, assistantStart: 3, assistantEnd: 4 }, historyPlan.batches[1]] },
]) {
    assert.throws(() => buildTodayTrendHistoryBatch(historyWindowMessages, invalidPlan, 0),
        error => error?.code === 'TT_HISTORY_WINDOW_INVALID', '伪造批次规划必须 fail-closed');
}
for (const input of [
    { messages: historyWindowMessages, recentAssistantCount: 0, mergeAssistantCount: 1 },
    { messages: historyWindowMessages, recentAssistantCount: 6, mergeAssistantCount: 1 },
    { messages: historyWindowMessages, recentAssistantCount: 2, mergeAssistantCount: 3 },
    { messages: historyWindowMessages, recentAssistantCount: 2, mergeAssistantCount: 0 },
    { messages: [{ role: 'assistant', content: '   ' }], recentAssistantCount: 1, mergeAssistantCount: 1 },
    { messages: [{ role: 'unknown', content: '未知角色' }], recentAssistantCount: 1, mergeAssistantCount: 1 },
]) {
    assert.throws(() => planTodayTrendHistoryBatches(input), error => error?.code === 'TT_HISTORY_WINDOW_INVALID',
        '历史正文规划必须拒绝越界、空消息和无效角色');
}

assert.equal(TODAY_TREND_VERSION, 1);
const originalDiagnosticWindow = globalThis.window;
globalThis.window = { __pmDiagEnabled: true };
try {
    let diagnosticManualRuns = 0;
    assert.equal(installDiagnosticApi({
        runtime: {}, getCtx: () => null, getStorageId: () => 'diagnostic-chat',
        getCalendarStore: () => ({ scopes: { 'diagnostic-chat': { baseDate: '2025-04-15' } } }),
        getTodayTrendStore: async () => ({ scopes: { 'diagnostic-chat': {
            operation: { lastSuccessfulAssistantCount: 42 },
            dynamics: { active: [{ stages: ['事件标题和阶段正文均不得泄露'] }], archived: [{ stages: ['另一段事件正文'] }] },
        } } }),
        getTodayTrendGenerationState: () => ({ phase: 'failed', lastError: 'TT_HISTORY_STAGE_MISMATCH 事件标题和阶段正文均不得泄露' }),
        generateTodayTrend: async () => {
            diagnosticManualRuns += 1;
            throw Object.assign(new Error('事件标题和阶段正文均不得泄露'), { code: 'TT_HISTORY_STAGE_MISMATCH' });
        },
    }), true, 'Today Trend 诊断必须在显式开关下安装');
    const diagnosticTrend = await window.__pmDiag.todayTrend.status();
    assert.deepEqual(diagnosticTrend.scope, {
        activeEventCount: 1, archivedEventCount: 1, stageCount: 2, lastSuccessfulAssistantCount: 42,
    }, 'Today Trend 诊断只能返回聚合状态');
    assert.deepEqual(diagnosticTrend.generation, { phase: 'failed', errorCode: 'TT_HISTORY_STAGE_MISMATCH' },
        'Today Trend 诊断不得透传原始错误正文');
    assert.equal(JSON.stringify(diagnosticTrend).includes('事件标题和阶段正文均不得泄露'), false,
        'Today Trend 诊断不得泄露事件或聊天正文');
    assert.deepEqual(await window.__pmDiag.todayTrend.runManual(), {
        ok: false, error: { name: 'Error', code: 'TT_HISTORY_STAGE_MISMATCH', message: '事件标题和阶段正文均不得泄露' },
    }, '控制台手动测试必须保留公开入口返回的结构化错误');
    assert.equal(diagnosticManualRuns, 1, '控制台手动测试必须恰好调用一次公开生成入口');
} finally {
    if (originalDiagnosticWindow === undefined) delete globalThis.window;
    else globalThis.window = originalDiagnosticWindow;
}
for (const contract of [
    installTodayTrend, normalizeTodayTrendStore, createTodayTrendStorage, createTodayTrendV2Authority, createTodayTrendCommitter,
    normalizeTodayTrendStageProjection, normalizeTodayTrendV2Candidate, resolveTodayTrendV2LatestStage,
    validateTodayTrendV2Transition,
    gatherTodayTrendContext, buildTodayTrendInitializationEnvelope, buildTodayTrendGenerationEnvelope,
    createTodayTrendGenerationController, createTodayTrendScheduler, renderTodayTrendInjection,
    renderTodayTrendApp, renderTodayTrendWorldView, renderTodayTrendReputationView,
    renderTodayTrendFactionView, renderTodayTrendDynamicsView, renderTodayTrendSettingsView,
    createTodayTrendActionDispatcher, resolveTodayTrendTitleIcon, installTodayTrendPhoneUi, renderPhoneDesktop,
]) assert.equal(typeof contract, 'function');

const hostCallbacks = new Map();
let hostChat = [{ mes: '旧助手回复' }];
const hostContext = {
    eventSource: { on: (event, callback) => hostCallbacks.set(event, [...(hostCallbacks.get(event) || []), callback]) },
    eventTypes: { MESSAGE_RECEIVED: 'message-received' }, chat: hostChat,
};
let activeHostContext = hostContext;
let activeHostStorageId = 'chat-a';
const observedHostChats = [];
const hostEventController = createPhoneHostEventController({
    state: {}, runtime: {},
    deps: { observeTodayTrendTurn: chat => observedHostChats.push(chat.map(message => message.mes)) },
    getCtx: () => activeHostContext, getStorageId: () => activeHostStorageId, isAutoPokeAllowed: () => false,
    disarmAutoPoke: () => {}, invalidateGeneration: () => {}, applyBidirectionalInjection: async () => {},
    handleHostChatChanged: () => {},
});
hostEventController.hookGenerationEvent();
hostCallbacks.get('message-received').forEach(callback => callback());
hostCallbacks.get('message-received').forEach(callback => callback());
hostChat = [{ mes: '旧助手回复' }, { mes: '本轮助手回复' }];
hostContext.chat = hostChat;
await Promise.resolve();
assert.deepEqual(observedHostChats, [['旧助手回复', '本轮助手回复']],
    '同一同步批次的重复宿主事件必须合并，并在微任务中只读取一次最终助手正文');
observedHostChats.length = 0;
hostCallbacks.get('message-received').forEach(callback => callback());
hostContext.chat = [{ mes: '旧助手回复' }, { mes: '本轮助手回复' }, { mes: '会话 A 的新助手回复' }];
activeHostContext = { chat: [{ mes: '会话 B 的助手回复' }] };
activeHostStorageId = 'chat-b';
await Promise.resolve();
assert.deepEqual(observedHostChats, [],
    '事件派发后若已切换聊天，延迟观察不得将旧会话正文写入当前会话 scope');
activeHostContext = hostContext;
activeHostStorageId = 'chat-a';

const originalConsoleWarn = console.warn;
let observationWarning = null;
console.warn = (...args) => { observationWarning = args; };
const rejectedHostCallbacks = new Map();
const rejectedHostContext = {
    eventSource: { on: (event, callback) => rejectedHostCallbacks.set(event, [...(rejectedHostCallbacks.get(event) || []), callback]) },
    eventTypes: { MESSAGE_RECEIVED: 'message-received' }, chat: [{ mes: '失败观察回复' }],
};
createPhoneHostEventController({
    state: {}, runtime: {}, deps: { observeTodayTrendTurn: () => Promise.reject(new Error('test rejection')) },
    getCtx: () => rejectedHostContext, getStorageId: () => 'chat-rejected', isAutoPokeAllowed: () => false,
    disarmAutoPoke: () => {}, invalidateGeneration: () => {}, applyBidirectionalInjection: async () => {}, handleHostChatChanged: () => {},
}).hookGenerationEvent();
rejectedHostCallbacks.get('message-received').forEach(callback => callback());
await new Promise(resolve => setTimeout(resolve, 0));
console.warn = originalConsoleWarn;
assert.match(String(observationWarning?.[0] || ''), /今日风向自动推演观察失败/,
    '今日风向观察 rejection 必须被消费并输出诊断，而非形成未处理 rejection');

const todayTrendStyle = (await readFile(new URL('../styles/today-trend.css', import.meta.url), 'utf8')).replace(/;\}/g, '}').replaceAll('../assets/', './assets/');
const todayTrendCoreStyle = await readFile(new URL('../styles/core.css', import.meta.url), 'utf8');
const [
    todayTrendUiText,
    todayTrendWorldViewText,
    todayTrendReputationViewText,
    todayTrendFactionViewText,
    todayTrendDynamicsViewText,
    todayTrendManifestText,
    todayTrendBuildText,
] = await Promise.all([
    '../src/today-trend-ui.js',
    '../src/today-trend-world-view.js',
    '../src/today-trend-reputation-view.js',
    '../src/today-trend-faction-view.js',
    '../src/today-trend-dynamics-view.js',
    '../manifest.json',
    '../index.js',
].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
const todayTrendViewSources = [
    ['世界态势', todayTrendWorldViewText],
    ['个人风评', todayTrendReputationViewText],
    ['势力图谱', todayTrendFactionViewText],
    ['事件追踪', todayTrendDynamicsViewText],
];
const todayTrendRuntimeText = [
    todayTrendUiText, ...todayTrendViewSources.map(([, source]) => source), todayTrendManifestText, todayTrendBuildText,
].join('\n');
const todayTrendCustomProperties = new Map([...`${todayTrendCoreStyle}\n${todayTrendStyle}`.matchAll(/(--[\w-]+):([^;{}]+)/g)].map(([, name, value]) => [name, value.trim()]));
const resolveTodayTrendToken = (token, depth = 0) => {
    if (depth >= 8) return token;
    const value = todayTrendCustomProperties.get(token) || token;
    const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1];
    return reference ? resolveTodayTrendToken(reference, depth + 1) : value;
};
const todayTrendRelationTokens = {
    hostile: ['--pm-today-trend-relation-hostile', '--pm-today-trend-relation-hostile-foreground', '#e8566c', '#fff'],
    dislike: ['--pm-today-trend-relation-dislike', '--pm-today-trend-relation-dislike-foreground', '#cc7a42', '#fff'],
    neutral: ['--pm-today-trend-relation-neutral', '--pm-today-trend-relation-neutral-foreground', '--pm-color-surface-control', '--pm-color-text-primary'],
    like: ['--pm-today-trend-relation-like', '--pm-today-trend-relation-like-foreground', '--pm-color-accent', '--pm-color-on-accent'],
    trust: ['--pm-today-trend-relation-trust', '--pm-today-trend-relation-trust-foreground', '#2d9e84', '#fff'],
};
const hexLuminance = hex => {
    const digits = hex.slice(1), expanded = digits.length === 3 ? [...digits].map(channel => `${channel}${channel}`).join('') : digits;
    const channels = expanded.match(/../g).map(channel => parseInt(channel, 16) / 255)
        .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrastRatio = (first, second) => {
    const firstLuminance = hexLuminance(first), secondLuminance = hexLuminance(second);
    return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
};
for (const [status, [surfaceToken, foregroundToken, expectedSurface, expectedForeground]] of Object.entries(todayTrendRelationTokens)) {
    const wrapValue = v => v.startsWith('--') ? `var\\(${v}\\)` : v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(todayTrendStyle, new RegExp(`${surfaceToken}:${wrapValue(expectedSurface)};${foregroundToken}:${wrapValue(expectedForeground)}`), `今日风向 ${status} 关系圆必须使用对应的语义表面与前景值`);
    const surface = resolveTodayTrendToken(surfaceToken).toLowerCase();
    const foreground = resolveTodayTrendToken(foregroundToken).toLowerCase();
    assert.match(surface, /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/, `今日风向 ${status} 关系表面必须能解析为实际 hex 颜色`);
    assert.match(foreground, /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/, `今日风向 ${status} 关系前景必须能解析为实际 hex 颜色`);
    assert.ok(contrastRatio(surface, foreground) >= 3, `今日风向 ${status} 关系表面与图标前景的对比度必须达到 3:1`);
}
assert.match(todayTrendStyle, /\.pm-today-trend-home\{[^}]*color:var\(--pm-color-on-accent\)!important/, '返回桌面图标默认态必须在主题色顶栏上使用高对比 on-accent 色');
assert.match(todayTrendStyle, /\.pm-today-trend-tabs button\{[^}]*color:var\(--pm-color-text-tertiary\)/, '底部导航未点亮图标必须使用辅助灰 text-tertiary 色');
assert.match(todayTrendStyle, /\.pm-today-trend-tabs button\[aria-pressed="true"\] svg\{[^}]*color:var\(--pm-color-accent\)/, '底部导航激活态必须使用主题 accent 色');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-tabs button svg\{[^}]*stroke-width:/, '底部导航 SVG 不得覆盖返回桌面所用的通用 2px 线宽');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-tabs[^{}]*svg\{[^}]*transform:/, '底部导航 SVG 不得使用独立 transform 覆盖返回桌面图标几何');
assert.match(todayTrendStyle, /\.pm-today-trend-content\.is-minimal-ui \.pm-today-trend-faction-entry-head \.pm-today-trend-relation-slot>\.pm-today-trend-faction-node\{[^}]*background:transparent[^}]*border:0[^}]*box-shadow:none[^}]*color:inherit/, '极简势力节点外层必须透明且不得显示大圆背景');
for (const variable of ['--pm-today-trend-report-rule']) {
    assert.match(todayTrendStyle, new RegExp(`${variable}:`), `今日风向重排必须声明 ${variable} 视觉变量`);
}
assert.match(todayTrendStyle, /--pm-today-trend-event-facts-start-offset:calc\(0px - var\(--pm-space-1\)\)/, '事件事实区上偏移 token 必须保持 -4px 等值计算链');
assert.match(todayTrendStyle, /--pm-today-trend-event-facts-end-offset:var\(--pm-space-0\)/, '事件事实区下偏移 token 必须保持合法零值');
assert.match(todayTrendStyle, /--pm-line-height-today-trend-meter:var\(--pm-space-4\)/, '统计仪表行高 token 必须保持 16px 等值计算链');
assert.match(todayTrendStyle, /--pm-today-trend-switch-width:var\(--pm-size-control-compact\);--pm-today-trend-switch-height:20px;--pm-today-trend-switch-knob:16px/, '今日风向开关尺寸 token 必须保持 36px、20px、16px 计算链');
assert.doesNotMatch(todayTrendStyle, /--pm-today-trend-(?:node-size|display-size)(?::|\))/, '世界态势新版不得保留已被局部 token 取代的通用尺寸变量或消费者');
assert.doesNotMatch(todayTrendStyle, /assets\/today-trend\/(?:world|reputation|faction|dynamics)\/(?:top|bottom|top-glow|starlight[^/]*)\.svg/, '今日风向不得继续引用头尾或星光 SVG');
assert.doesNotMatch(todayTrendStyle, /assets\/today-trend\/world\/middle-repeat\.svg|pm-today-trend-world-grid/, '世界态势卡片化后不得继续消费重复网格背景');
assert.doesNotMatch(todayTrendRuntimeText, /assets\/today-trend\/(?:world|dynamics)\/[^"'\s)]+\.svg|pm-today-trend-world-(?:grid|brief-tail)/, '源码、清单与构建产物不得继续引用已删除的世界态势或事件追踪装饰资源');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:world|reputation|factions|dynamics)::(?:before|after)[^{]*\{[^}]*(?:background(?:-image)?|content|-webkit-mask(?:-image)?|mask(?:-image)?)[^}]*url\(/, '今日风向模块根节点不得通过伪元素恢复图片装饰');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:world|faction|reputation|dynamics)-(?:head|foot)-art/, '今日风向头尾装饰 SVG 样式必须清理');




const compactTodayTrendMediaStart = todayTrendStyle.lastIndexOf('@media(max-width:320px)');
const compactTodayTrendMedia = todayTrendStyle.slice(compactTodayTrendMediaStart, todayTrendStyle.indexOf('\n', compactTodayTrendMediaStart));
assert.doesNotMatch(compactTodayTrendMedia, /pm-today-trend-event-body>header\{flex-wrap:wrap/, '事件追踪窄屏不得保留已移出标题栏的操作区换行规则');
assert.match(todayTrendStyle, /pm-today-trend-event-badge,\.pm-today-trend-event-pill\{[^}]*font-size:var\(--pm-font-size-micro\)/, '事件追踪徽章必须使用超小字号');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-event-card header span/, '事件追踪不得用宽泛 header span 规则覆盖徽章字号');
assert.match(todayTrendStyle, /\.pm-today-trend-inline-action\{width:var\(--pm-size-control-compact\);min-height:var\(--pm-size-control-compact\)/, '行内操作按钮必须保留 36px 紧凑触控区');
assert.match(todayTrendStyle, /\.pm-today-trend-menu-action svg,\.pm-today-trend-menu-close svg,\.pm-today-trend-inline-action svg\{display:block;width:var\(--pm-size-icon-sm\);height:var\(--pm-size-icon-sm\)/, '菜单与行内操作图标必须消费同一尺寸契约');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-inline-action[^{}]*svg\{[^}]*transform:/, '行内操作图标不得使用逐图标位移伪造对齐');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-icon-button\[data-action\^="today-trend-edit-"\] svg\{[^}]*translate(?:Y|\([^,]+,\s*(?!0(?:px)?\b))/, '编辑图标不得保留向下偏移');
assert.match(todayTrendStyle, /\.pm-today-trend-header\{[^}]*display:flex[^}]*justify-content:space-between/, '去除页面标题后，顶栏必须仅用返回与全局操作维持左右布局');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-header h2\{/, '顶栏不得保留重复的“今日风向”标题样式');
assert.match(todayTrendStyle, /\.pm-today-trend-content\.is-world \.pm-today-trend-module-head\.is-expanded,[^}]*\{position:sticky[^}]*top:var\(--pm-space-0\)[^}]*z-index:var\(--pm-z-content\)[^}]*align-items:center[^}]*flex-direction:column[^}]*padding:var\(--pm-space-2\) var\(--pm-space-4\) var\(--pm-space-0\)/, '内容模块头必须固定在滚动区顶部，并为跨层操作圆保留无底部填充的主题色接缝');
assert.match(todayTrendStyle, /\.pm-today-trend-module-head\.is-expanded>div\{[^}]*align-items:center[^}]*text-align:center/, '固定模块头中的元数据与标题必须保持居中');
assert.match(todayTrendStyle, /\.pm-today-trend-module-head\.is-expanded \.pm-today-trend-head-tools\{position:absolute[^}]*top:var\(--pm-space-2\)[^}]*right:var\(--pm-space-4\)/, '固定模块头的楼层状态必须固定在右上角，不能挤压居中标题');
assert.match(todayTrendStyle, /\.pm-today-trend-module-actions\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center[^}]*gap:var\(--pm-space-2\)[^}]*transform:translateY\(50%\)/, '模块操作必须组成居中圆形图标行，并跨在主题色与内容层接缝');
assert.match(todayTrendStyle, /\.pm-today-trend-module-actions \.pm-today-trend-icon-button\{[^}]*background:var\(--pm-color-surface-page\)[^}]*color:var\(--pm-color-accent\)/, '模块操作圆必须使用页面色底与主题色 SVG 前景');
assert.match(todayTrendStyle, /\.pm-today-trend-content\.is-world\{[^}]*background:var\(--pm-color-accent\)/, '世界态势标题层外侧必须延续主题色，覆盖与返回顶栏相切的内容容器圆角接缝');
assert.match(todayTrendStyle, /\.pm-today-trend-content\.is-reputation,\.pm-today-trend-content\.is-faction,\.pm-today-trend-content\.is-dynamics\{[^}]*background:var\(--pm-color-accent\)/, '其余四字模块标题层外侧必须同样延续主题色，不能只修复世界态势');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:world|reputation|factions|dynamics)[^{}]*\.pm-today-trend-floor[^{}]*\{[^}]*position:absolute/, '四个模块楼层不得使用绝对定位');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:world|reputation|factions|dynamics)[^{}]*\.pm-today-trend-menu-wrap\.is-open\{[^}]*position:absolute/, '四个模块菜单展开态不得使用绝对定位脱离文档流');
assert.match(todayTrendStyle, /\.pm-today-trend-floor\{[^}]*min-width:max-content[^}]*flex:0 0 auto/, '#楼层仪表必须按完整内容保留宽度，不能截断多位楼层');
assert.match(todayTrendStyle, /\.pm-today-trend-floor-value\{[^}]*color:var\(--pm-color-text-secondary\)/, '楼层数值必须使用界面稍深的次级灰色而非纯黑');
assert.match(todayTrendStyle, /\.pm-today-trend-floor-cancel\{[^}]*cursor:pointer/, '同步状态必须提供明确可点击的终止控件');
assert.match(todayTrendStyle, /\.pm-today-trend-floor-status\{[^}]*font-size:var\(--pm-font-size-micro\)/, '同步状态文字必须与待同步和已同步使用相同的超小字号');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-floor-cancel\{[^}]*font:inherit/, '同步终止按钮不得用 font shorthand 覆盖状态文字字号');
assert.match(todayTrendStyle, /\.pm-today-trend-floor\[data-state="failed"\] \.pm-today-trend-floor-status\{[^}]*color:var\(--pm-color-danger\)/, '同步失败状态必须使用失败反馈色');
assert.match(todayTrendStyle, /\.pm-today-trend-floor-reading\{[^}]*white-space:nowrap/, '#号与楼层数值必须保持单行完整显示');
assert.match(todayTrendRuntimeText, /pm-today-trend-head-tools">\$\{menu\}\$\{asideHtml\}/, '模块头必须先渲染三点菜单，再在其下方渲染楼层');
const todayTrendModuleBodySourceCount = todayTrendViewSources.reduce((count, [, source]) => count + (source.match(/class="pm-today-trend-module-body"/g) || []).length, 0);
for (const [moduleName, source] of todayTrendViewSources) {
    assert.ok((source.match(/class="pm-today-trend-module-body"/g) || []).length >= 1,
        `${moduleName}源码必须声明灰色内容层容器`);
}
assert.equal((todayTrendBuildText.match(/class="pm-today-trend-module-body"/g) || []).length, todayTrendModuleBodySourceCount,
    '构建产物必须同步包含源视图声明的全部今日风向灰色内容层容器');
assert.match(todayTrendStyle, /\.pm-today-trend-dynamics\{gap:var\(--pm-space-0\);?\}/, '事件追踪主题色标题层与灰色内容层必须无额外间隙拼接');
assert.match(todayTrendStyle, /\.pm-today-trend-event-list\{[^}]*padding:var\(--pm-space-0-5\) var\(--pm-space-0\) var\(--pm-space-1\)/, '事件追踪列表顶部留白必须同步收紧');
assert.match(compactTodayTrendMedia, /pm-today-trend-module-head\{gap:var\(--pm-space-1\)/, '320px 窄屏必须缩小标题与工具区间距并保留按钮命中区');
assert.match(compactTodayTrendMedia, /pm-today-trend-module-body\{padding-inline:var\(--pm-space-3\)/, '320px 窄屏必须只收紧灰色内容层的横向留白');
assert.doesNotMatch(compactTodayTrendMedia, /pm-today-trend-(?:world|reputation|factions|dynamics)\{[^}]*padding-inline/, '320px 窄屏不得收窄模块根，避免主题色模块头两侧露灰');
assert.match(todayTrendStyle, /\.pm-today-trend-menu-action,\.pm-today-trend-menu-close\{flex-basis:var\(--pm-size-control-compact\);width:var\(--pm-size-control-compact\);min-height:var\(--pm-size-control-compact\)/, '320px 菜单按钮不得缩回 28px 命中区');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-icon-button\[data-action\^="today-trend-(?:refresh|generate)"\]\{width:28px/, '今日风向真实操作按钮不得使用 28px 命中区');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-content\.is-(?:reputation|faction|dynamics)::/, '旧内容容器背景伪元素必须清理');
assert.match(todayTrendStyle, /pm-today-trend-world-hero,\.pm-today-trend-world-brief\{[^}]*padding:var\(--pm-space-4\)[^}]*border:0[^}]*border-radius:var\(--pm-radius-card\)[^}]*background:var\(--pm-color-surface-page\)[^}]*box-shadow:none/, '世界态势卡片必须零描边并比内容区背景更白（顶栏主题色实底改造）');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry\{[^}]*padding:var\(--pm-space-4\)[^}]*border:0[^}]*border-radius:var\(--pm-radius-card\)[^}]*background:var\(--pm-color-surface-page\)[^}]*box-shadow:none/, '个人风评卡片必须零描边并比内容区背景更白（顶栏主题色实底改造）');
assert.match(todayTrendStyle, /pm-today-trend-event-card\{[^}]*padding:var\(--pm-space-4\)[^}]*border:0[^}]*border-radius:var\(--pm-radius-card\)[^}]*background:var\(--pm-color-surface-page\)[^}]*box-shadow:none/, '事件追踪卡片必须零描边并比内容区背景更白（顶栏主题色实底改造）');
assert.match(todayTrendStyle, /pm-today-trend-faction-card\{[^}]*padding:var\(--pm-space-4\)[^}]*border:0[^}]*border-radius:var\(--pm-radius-card\)[^}]*background:var\(--pm-color-surface-page\)[^}]*box-shadow:none/, '势力图谱卡片必须零描边并比内容区背景更白（顶栏主题色实底改造）');
assert.match(todayTrendStyle, /\.pm-today-trend-item-editor\{[^}]*width:100%[^}]*min-width:0[^}]*gap:var\(--pm-space-3\)[^}]*border:0[^}]*background:transparent[^}]*box-shadow:none/, '条目编辑器必须占满可用宽度并保持无装饰性描边');
assert.match(todayTrendStyle, /\.pm-today-trend-item-editor \.pm-today-trend-field\{[^}]*gap:var\(--pm-space-2\)/, '条目编辑器字段之间必须使用宽松的标签—控件间距');
assert.match(todayTrendStyle, /\.pm-today-trend-item-editor fieldset\{[^}]*border:0[^}]*padding:var\(--pm-space-0\)/, '条目编辑器分组不得恢复旧描边和内层卡片');
assert.match(todayTrendStyle, /\.pm-action-pair\{[^}]*display:grid[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[^}]*gap:var\(--pm-space-2\)[^}]*min-width:0/, '仅双操作按钮组必须使用可收缩的双列布局');
assert.match(todayTrendStyle, /\.pm-today-trend-item-editor \.pm-today-trend-form-actions button\{[^}]*min-height:var\(--pm-size-control-default\)/, '条目编辑器按钮必须保持舒适触控高度');
assert.match(compactTodayTrendMedia, /pm-action-pair\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, '320px 窄屏必须保持双操作按钮并列且可收缩');
assert.match(todayTrendStyle, /\.pm-today-trend-world-hero>\.pm-today-trend-world-item-editor,\.pm-today-trend-world-brief>\.pm-today-trend-world-item-editor\{grid-column:1 \/ -1\}/, '世界态势条目编辑器必须跨越完整内容轨道');
const entryRail = 'display:grid;grid-template-columns:var(--pm-today-trend-relation-node-size) var(--pm-space-2) minmax(0,1fr);row-gap:var(--pm-space-2)';
for (const [selector, prefix] of [
    ['世界态势条目', '.pm-today-trend-world-hero,.pm-today-trend-world-brief{box-sizing:border-box;'],
    ['个人风评条目正文', '.pm-today-trend-reputation-entry-body{'],
    ['势力图谱条目正文', '.pm-today-trend-faction-entry-body{'],
]) assert.ok(todayTrendStyle.includes(`${prefix}${entryRail}`), `${selector} 必须使用共享的节点—间隔—文本轨道`);
assert.ok(todayTrendStyle.includes('.pm-today-trend-world-hero>.pm-today-trend-world-item-head,.pm-today-trend-world-brief>.pm-today-trend-world-item-head{grid-column:1 / -1}'), '世界态势条目标题必须横跨完整轨道');
for (const selector of ['.pm-today-trend-world-hero p{grid-column:3;', '.pm-today-trend-world-brief p{grid-column:3;', '.pm-today-trend-reputation-entry-body>p{grid-column:3;', '.pm-today-trend-faction-summary{grid-column:3;']) {
    assert.ok(todayTrendStyle.includes(selector), `${selector} 必须落在统一文本轨道`);
}
for (const selector of ['.pm-today-trend-reputation-rating{grid-column:1 / -1;', '.pm-today-trend-faction-detail{grid-column:1 / -1;', '.pm-today-trend-faction-rating{grid-column:1 / -1;']) {
    assert.ok(todayTrendStyle.includes(selector), `${selector} 必跨完整条目轨道`);
}
assert.match(todayTrendStyle, /--pm-today-trend-world-hero-copy-size:var\(--pm-font-size-label\)/, '世界态势首条正文必须与后续条目使用同一字号');
assert.match(todayTrendStyle, /\.pm-today-trend-world-hero p\{[^}]*font-size:var\(--pm-today-trend-world-hero-copy-size\)/, '世界态势 hero 正文必须继续消费 hero copy 字号变量');
assert.match(todayTrendStyle, /\.pm-today-trend-reputation-entry-body>p\{[^}]*font-size:var\(--pm-font-size-label\)/, '个人风评正文必须与世界态势 hero 统一字号');
assert.match(todayTrendStyle, /\.pm-today-trend-faction-summary\{[^}]*font-size:var\(--pm-font-size-compact\)/, '势力图谱摘要必须与世界态势 hero 统一字号');
assert.match(todayTrendStyle, /\.pm-today-trend-reputation-list\{[^}]*padding:var\(--pm-space-0\)(?:;|\})/, '个人风评列表必须使用单值零间距 padding');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-reputation-list\{[^}]*padding:[^;}]*var\(--pm-space-1\)/, '个人风评列表不得恢复额外上下留白');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-reputation-entry-body>p\{[^}]*font-size:var\(--pm-font-size-body\)/, '个人风评正文不得回退到 body 字号');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-reputation-entry-body>p\{[^}]*font-size:var\(--pm-font-size-compact\)/, '个人风评正文不得回退到 compact 字号');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-faction-summary\{[^}]*font-size:var\(--pm-font-size-label\)/, '势力图谱摘要不得回退到 label 字号');
assert.match(todayTrendStyle, /\.pm-today-trend-world-hero p\{[^}]*line-height:var\(--pm-line-height-body\)/, '世界态势 hero 正文行距必须与个人风评统一');
assert.match(todayTrendStyle, /\.pm-today-trend-world-brief p\{[^}]*line-height:var\(--pm-line-height-body\)/, '世界态势次级摘要正文行距必须与个人风评统一');
assert.match(todayTrendStyle, /\.pm-today-trend-faction-summary\{[^}]*line-height:var\(--pm-line-height-body\)/, '势力图谱摘要行距必须与个人风评统一');
assert.doesNotMatch(todayTrendStyle, /(?:^|\})\.pm-today-trend-world-hero p\{[^}]*line-height:var\(--pm-line-height-loose\)/, '普通模式世界态势 hero 正文不得保留旧宽松行距');
assert.doesNotMatch(todayTrendStyle, /(?:^|\})\.pm-today-trend-world-brief p\{[^}]*line-height:var\(--pm-line-height-loose\)/, '普通模式世界态势次级摘要正文不得保留旧宽松行距');
assert.doesNotMatch(todayTrendStyle, /(?:^|\})\.pm-today-trend-faction-summary\{[^}]*line-height:var\(--pm-line-height-loose\)/, '普通模式势力图谱摘要不得保留旧宽松行距');
assert.match(todayTrendStyle, /pm-today-trend-faction-entry-head \.pm-today-trend-relation-slot>\.pm-today-trend-faction-node\{[^}]*border-radius:var\(--pm-radius-circle\)[^}]*background:var\(--pm-color-accent\)/, '势力节点必须归入标题行并使用圆形主题节点');
assert.match(todayTrendStyle, /pm-today-trend-faction-meter>span\.is-active\{[^}]*border-bottom-color:var\(--pm-color-accent\)/, '势力关系量表必须使用横向选中下划线');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-faction-meter[^{}]*(?:grid-template-rows|::after|rotate\(45deg\))/, '势力关系量表不得恢复旧纵向游标结构');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-world-brief\.is-(?:left|right)|pm-today-trend-faction-tree(?:\[[^}]+)?\{[^}]*border-left/, '卡片化源码不得残留世界左右轨道选择器或势力树左轨声明');
assert.match(todayTrendStyle, /pm-today-trend-event-history\[open\][^}]*overflow:hidden/, '动态阶段记录展开态必须约束布局溢出');
assert.ok(PHONE_UI_PAGES.includes('today-trend'), '手机页面白名单必须包含今日风向');
const phoneUiDeps = { getStorageId: () => 'chat' };
const phoneUi = installTodayTrendPhoneUi({}, phoneUiDeps);
const invalidPhoneUi = installTodayTrendPhoneUi({}, { getStorageId: () => 'sms_unknown__default' });
await assert.rejects(invalidPhoneUi.show(), /有效的角色聊天/, '无效聊天不得切换至今日风向页面');
assert.deepEqual(Object.keys(phoneUi).sort(), ['bind', 'destroy', 'render', 'show']);
for (const key of ['bindTodayTrendPhoneUi', 'destroyTodayTrendPhoneUi', 'showTodayTrendPage', 'renderTodayTrendPage']) {
    assert.equal(typeof phoneUiDeps[key], 'function', `今日风向手机 UI 必须注入 ${key}`);
}
const todayTrendDesktop = renderPhoneDesktop({ scenes: {} }, { pinnedSceneIds: [] });
assert.match(todayTrendDesktop, /data-app="today-trend"[^>]*data-action="desktop-today-trend"/, '桌面必须提供今日风向入口');
assert.match(todayTrendDesktop, /aria-label="今日风向"/, '今日风向桌面入口必须具备可访问名称');
const originalWindow = globalThis.window;
const phoneListeners = [];
const pageContainer = { isConnected: true, innerHTML: '' };
const homeTrigger = {
    dataset: { todayTrendUiAction: 'home' },
    closest: selector => selector.includes('data-today-trend-ui-action') ? homeTrigger : null,
};
const closeTrigger = {
    dataset: { todayTrendUiAction: 'close' },
    closest: selector => selector.includes('data-today-trend-ui-action') ? closeTrigger : null,
};
const phoneWindow = {
    dataset: {},
    querySelector: selector => selector === '.pm-today-trend-page' ? pageContainer : null,
    addEventListener: (type, listener) => { if (type === 'click') phoneListeners.push(listener); },
    contains: node => node === homeTrigger || node === closeTrigger,
};
let shownPage = null;
let desktopCalls = 0;
let closeCalls = 0;
globalThis.window = { __pmShowPhonePage: page => { shownPage = page; return true; }, __pmEnd: () => { closeCalls += 1; } };
try {
    const mountedPhoneUi = installTodayTrendPhoneUi({ phoneWindow }, {
        getStorageId: () => 'chat',
        getTodayTrendStore: async () => ({ scopes: { chat: { characterName: '小明', presetId: 'preset' } } }),
        showPhoneDesktopPage: async () => { desktopCalls += 1; },
    });
    assert.equal(mountedPhoneUi.bind(phoneWindow), true, '手机窗口必须绑定今日风向返回事件');
    assert.equal(mountedPhoneUi.bind(phoneWindow), false, '同一手机窗口不得重复绑定今日风向事件');
    await mountedPhoneUi.show();
    assert.equal(shownPage, 'today-trend', '展示今日风向必须切换到目标页面');
    assert.match(pageContainer.innerHTML, /id="pm-today-trend-app"/, '展示今日风向必须渲染页面壳');
    phoneListeners[0]({ target: homeTrigger });
    await Promise.resolve();
    assert.equal(desktopCalls, 1, '首页按钮必须复用桌面页面切换');
    phoneListeners[0]({ target: closeTrigger });
    assert.equal(closeCalls, 1, '省略号动作组内的关闭按钮必须继续复用手机关闭行为');
} finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
}

const concurrentPhoneListeners = [];
const concurrentPhoneContainer = {
    isConnected: true, innerHTML: '', contains: () => true,
    addEventListener: (type, listener, capture = false) => concurrentPhoneListeners.push({ type, listener, capture }),
    removeEventListener: (type, listener, capture = false) => {
        const index = concurrentPhoneListeners.findIndex(item => item.type === type && item.listener === listener && item.capture === capture);
        if (index >= 0) concurrentPhoneListeners.splice(index, 1);
    },
};
const concurrentPhoneState = { phoneWindow: { querySelector: selector => selector === '.pm-today-trend-page' ? concurrentPhoneContainer : null } };
let rejectFirstPhoneStore;
let phoneStoreCalls = 0;
let phoneGenerationUnsubscribes = 0;
const concurrentPhoneStore = { scopes: {}, presets: {} };
const concurrentPhoneUi = installTodayTrendPhoneUi(concurrentPhoneState, {
    getStorageId: () => 'chat',
    getTodayTrendStore: () => {
        phoneStoreCalls += 1;
        if (phoneStoreCalls === 1) return new Promise((resolve, reject) => { rejectFirstPhoneStore = reject; });
        return Promise.resolve(concurrentPhoneStore);
    },
    getTodayTrendGenerationState: () => ({ phase: 'idle', task: null }),
    subscribeTodayTrendGeneration: listener => {
        listener({ phase: 'idle', task: null });
        return () => { phoneGenerationUnsubscribes += 1; };
    },
});
const stalePhoneRender = concurrentPhoneUi.render();
await Promise.resolve();
const currentPhoneRender = concurrentPhoneUi.render();
assert.equal(await currentPhoneRender, true, '后发手机页面渲染必须成功接管当前控制器');
rejectFirstPhoneStore(new Error('stale render failed'));
assert.equal(await stalePhoneRender, false, '旧手机页面渲染失败必须安全收敛');
assert.equal(phoneGenerationUnsubscribes, 1, '旧渲染失败不得销毁后发成功控制器');
concurrentPhoneUi.destroy();
assert.equal(phoneGenerationUnsubscribes, 2, '显式销毁时必须清理当前控制器订阅');

assert.deepEqual(normalizeTodayTrendStore(), createEmptyTodayTrendStore(), '缺失存储必须归一为空 store');
assert.equal(migrateTodayTrendStore({ presets: {}, scopes: {} }).migrated, true, '缺失版本的旧数据必须通过纯迁移入口升级');
assert.equal(migrateTodayTrendStore(createEmptyTodayTrendStore()).migrated, false, '当前版本不得重复迁移');
assert.throws(() => normalizeTodayTrendStore({}), error => error?.code === 'TT_STORE_VERSION', '非空无版本数据不得绕过迁移入口');
assert.throws(() => migrateTodayTrendStore({ version: 0, presets: {}, scopes: {} }), error => error?.code === 'TT_STORE_VERSION', '旧版本必须拒绝');
assert.throws(() => migrateTodayTrendStore({ version: 2, presets: {}, scopes: {} }), error => error?.code === 'TT_STORE_VERSION', '未来版本必须拒绝');
assert.deepEqual(TODAY_TREND_RELATION_STATUSES.map(todayTrendStatusLabel), ['敌对', '厌恶', '中立', '喜欢', '信任']);
assert.equal(todayTrendStatusLabel('unknown'), '');
assert.deepEqual(TODAY_TREND_EVENT_TYPES, ['normal', 'incident', 'rumor', 'underground']);
assert.deepEqual(TODAY_TREND_EVENT_LIFECYCLES, ['active', 'archived']);
assert.deepEqual(TODAY_TREND_EVENT_OUTCOMES, ['resolved', 'failed', 'terminated', 'inconclusive', 'confirmed', 'debunked', 'absorbed']);
assert.deepEqual(TODAY_TREND_OPERATION_MODES, ['manual', 'auto']);
assert.deepEqual(TODAY_TREND_STATUS_LABELS, { hostile: '敌对', dislike: '厌恶', neutral: '中立', like: '喜欢', trust: '信任' });

const fixture = () => createTodayTrendV1Fixture(createDefaultTodayTrendDynamicsSettings);
const assertCode = (mutate, code) => assert.throws(() => normalizeTodayTrendStore(mutate()), error => error?.code === code);
const valid = normalizeTodayTrendStore(fixture());
const migratedValidV2 = migrateTodayTrendStoreToV2(valid).store;
const batchBaselineValidV2 = applyTodayTrendGenerationToV2(migratedValidV2, 'chat',
    buildReadOnlyShadow(migratedValidV2).scopes.chat, { events: [] },
    { assistantCount: 0, generatedAt: 0 });
const batchReadyValidV2 = applyTodayTrendGenerationToV2(batchBaselineValidV2, 'chat',
    buildReadOnlyShadow(batchBaselineValidV2).scopes.chat, { events: [] },
    { assistantCount: 7, generatedAt: 7 });
const initializationReplacement = replaceTodayTrendV2ScopeWithInitialization(migratedValidV2, valid, 'chat', 123);
const initializationReplacementPayload = initializationReplacement.globalEnvelope.payload.scopes.chat.payload;
assert.doesNotThrow(() => validateTodayTrendV2Transition(migratedValidV2, initializationReplacement),
    '含 archived 但不含 removed lifecycle 的 canonical scope 必须允许受控初始化替换');
assert.deepEqual(initializationReplacementPayload.generationSnapshots.map(snapshot => snapshot.assistantCount), [0],
    '受控初始化替换必须只留下 full@0 checkpoint');
assert.equal(initializationReplacementPayload.generationSnapshots[0].restoreCapability, 'full',
    '受控初始化替换的唯一 checkpoint 必须可完整回退');
assert.equal(initializationReplacementPayload.generationSnapshots[0].rerollFromAssistantCount, null,
    '受控初始化替换的 floor 0 checkpoint 不得伪造 reroll 来源');
assert.deepEqual(initializationReplacementPayload.dynamics.archived.map(event => event.archivedSequence), [1],
    '受控初始化替换必须从新基线保留连续 archivedSequence');
assert.equal(initializationReplacementPayload.historyRetentionState.nextArchivedSequence, 2,
    '受控初始化替换必须令 nextArchivedSequence 紧随新基线归档事件');
assert.deepEqual(initializationReplacementPayload.removableEntityTombstonesById, {},
    '受控初始化替换不得携带旧 scope 的 tombstone');
const batchResetReplacement = replaceTodayTrendV2ScopeWithBatchReset(batchReadyValidV2, 'chat', 124);
const batchResetPayload = batchResetReplacement.globalEnvelope.payload.scopes.chat.payload;
assert.doesNotThrow(() => validateTodayTrendV2Transition(batchReadyValidV2, batchResetReplacement),
    '批量更新开始时必须允许受控替换为合法空内容');
assert.deepEqual(buildReadOnlyShadow(batchResetReplacement).scopes.chat, {
    ...buildReadOnlyShadow(batchResetReplacement).scopes.chat,
    world: { items: [] }, reputation: { circles: [] }, factions: [], dynamics: { active: [], archived: [] },
}, '批量更新重置必须删除全部旧展示内容');
assert.deepEqual(batchResetPayload.generationSnapshots.map(snapshot => snapshot.assistantCount), [0],
    '批量更新重置必须只保留新的空内容 floor 0 checkpoint');
const batchResetBlocked = structuredClone(batchReadyValidV2);
batchResetBlocked.globalEnvelope.payload.scopes.chat.payload.removableEntityTombstonesById = {
    'detail:service:1': { entityType: 'detail', entityId: 'detail:service:1', eventId: 'service', state: 'removed',
        removalReason: 'archived-retention', removedAtAssistantCount: 7, policyRevision: 1 },
};
batchResetBlocked.globalEnvelope.payload.scopes.chat.payload.removableEntityStateById = structuredClone(
    batchResetBlocked.globalEnvelope.payload.scopes.chat.payload.removableEntityTombstonesById,
);
assert.throws(() => replaceTodayTrendV2ScopeWithBatchReset(batchResetBlocked, 'chat'),
    error => error?.code === 'TT_INITIALIZATION_REBUILD_BLOCKED', '含不可逆 removed lifecycle 的 scope 不得静默清空');
const archivedFixedCore = extractArchivedFixedCore(migratedValidV2.globalEnvelope.payload.scopes.chat.payload.dynamics.archived[0]);
assert.equal(archivedFixedCore.id, 'rumor', 'fixed core 必须保留归档事件身份');
assert.equal(archivedFixedCore.archivedSequence, 1, 'fixed core 必须保留确定性 archivedSequence');
const originalArchivedParticipant = migratedValidV2.globalEnvelope.payload.scopes.chat.payload.dynamics.archived[0].participants[0];
archivedFixedCore.participants[0] = '被篡改的副本';
assert.equal(migratedValidV2.globalEnvelope.payload.scopes.chat.payload.dynamics.archived[0].participants[0], originalArchivedParticipant,
    'fixed core 必须深拷贝嵌套字段，调用方修改结果不得污染 v2 store');
assert.throws(() => extractArchivedFixedCore(migratedValidV2.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0]),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', 'fixed core 必须拒绝从 active event 提取');
const equalShadowDiff = diffReadOnlyShadow(valid, migratedValidV2);
assert.deepEqual({ equal: equalShadowDiff.equal, byteDifference: equalShadowDiff.byteDifference }, { equal: true, byteDifference: 0 },
    'v2 只读影子与迁移源语义一致时必须报告零差异');
const changedShadowStore = structuredClone(migratedValidV2);
changedShadowStore.globalEnvelope.payload.presets.preset.name = '不同的节目世界';
const changedShadowDiff = diffReadOnlyShadow(valid, changedShadowStore);
assert.equal(changedShadowDiff.equal, false, 'v2 只读影子的用户可见字段变化必须被识别');
assert.ok(changedShadowDiff.byteDifference > 0, 'shadow diff 不一致时必须提供非零差异量');
assert.deepEqual(valid.scopes.chat.generationSnapshots.map(item => item.assistantCount), [0, 7], '旧 scope 缺少快照历史时必须同时生成初始化基线与当前 checkpoint 兼容快照');
assert.deepEqual(valid.scopes.chat.generationSnapshots[0].world, valid.scopes.chat.world, '兼容迁移无法反推历史时必须以现有资料建立安全基线，不能清空用户数据');
const emptySnapshotStore = fixture();
emptySnapshotStore.scopes.chat.generationSnapshots = [];
const normalizedEmptySnapshotScope = normalizeTodayTrendStore(emptySnapshotStore).scopes.chat;
assert.deepEqual(normalizedEmptySnapshotScope.generationSnapshots.map(item => item.assistantCount), [0, 7], '显式空快照历史也必须补建初始化基线与当前 checkpoint');
const firstGeneratedAfterEmpty = appendTodayTrendGenerationSnapshot(normalizedEmptySnapshotScope, 10, 12);
assert.deepEqual(firstGeneratedAfterEmpty.generationSnapshots.map(item => item.assistantCount), [0, 7, 10], '显式空历史迁移后首次生成不得丢失 0 楼基线');
const copiedScope = copyTodayTrendScope(valid.scopes.chat, 'copied-chat');
assert.deepEqual(copiedScope.generationSnapshots.map(item => item.assistantCount), [0], '复制 scope 必须以复制时资料建立独立的 0 楼基线');
assert.deepEqual(copiedScope.generationSnapshots[0].world, valid.scopes.chat.world, '复制 scope 的初始化基线必须保留复制时资料');
const floorTenScope = appendTodayTrendGenerationSnapshot({
    ...valid.scopes.chat,
    operation: { ...valid.scopes.chat.operation, lastSuccessfulAssistantCount: 10, lastSuccessfulRunAt: 12 },
    world: { items: [{ ...valid.scopes.chat.world.items[0], summary: '第十楼结果' }] },
}, 10, 12);
assert.deepEqual(floorTenScope.generationSnapshots.map(item => item.assistantCount), [0, 7, 10], '完整生成快照必须保留初始化基线并按楼层升序追加');
const replacedFloorTenScope = appendTodayTrendGenerationSnapshot({
    ...floorTenScope,
    world: { items: [{ ...floorTenScope.world.items[0], summary: '第十楼替换结果' }] },
}, 10, 13);
assert.deepEqual(replacedFloorTenScope.generationSnapshots.map(item => item.assistantCount), [0, 7, 10], '同楼重新生成必须覆盖而非重复追加快照');
assert.equal(replacedFloorTenScope.generationSnapshots.at(-1).world.items[0].summary, '第十楼替换结果', '同楼快照必须保存最新完整生成结果');
let boundedSnapshotScope = valid.scopes.chat;
for (let floor = 8; floor <= 20; floor += 1) boundedSnapshotScope = appendTodayTrendGenerationSnapshot(boundedSnapshotScope, floor, floor);
assert.equal(boundedSnapshotScope.generationSnapshots.length, TODAY_TREND_LIMITS.generationSnapshots, '追加快照超过容量后必须只保留最近受控数量');
assert.deepEqual(boundedSnapshotScope.generationSnapshots.map(item => item.assistantCount), [0, ...Array.from({ length: 11 }, (_, index) => index + 10)], '快照容量裁剪必须永久保留初始化基线与最近楼层');
const excessiveSnapshots = fixture();
excessiveSnapshots.scopes.chat.generationSnapshots = Array.from({ length: TODAY_TREND_LIMITS.generationSnapshots + 1 }, (_, assistantCount) => ({
    assistantCount, generatedAt: assistantCount,
    world: valid.scopes.chat.world, reputation: valid.scopes.chat.reputation, factions: valid.scopes.chat.factions,
    dynamicsSettings: valid.scopes.chat.dynamicsSettings, dynamics: valid.scopes.chat.dynamics,
}));
assertCode(() => excessiveSnapshots, 'TT_SNAPSHOT_LIMIT');
const nestedSnapshotStore = fixture();
nestedSnapshotStore.scopes.chat.generationSnapshots = [{
    ...valid.scopes.chat.generationSnapshots[1],
    generationSnapshots: [{ ...valid.scopes.chat.generationSnapshots[0] }],
}];
assert.equal(Object.hasOwn(normalizeTodayTrendStore(nestedSnapshotStore).scopes.chat.generationSnapshots[0], 'generationSnapshots'), false, '快照内部夹带的嵌套历史必须被截断，避免递归膨胀');
const rolledBackScope = rollbackTodayTrendScope(replacedFloorTenScope, 8);
assert.equal(rolledBackScope.operation.lastSuccessfulAssistantCount, 7, '聊天回退必须恢复不高于当前楼层的最近 checkpoint');
assert.equal(rolledBackScope.world.items[0].summary, '晚餐服务临近', '聊天回退必须恢复对应楼层的生成内容');
assert.deepEqual(rolledBackScope.generationSnapshots.map(item => item.assistantCount), [0, 7], '聊天回退必须裁剪已消失楼层之后的快照并保留初始化基线');
const baselineRollbackScope = rollbackTodayTrendScope(valid.scopes.chat, 1);
assert.equal(baselineRollbackScope.operation.lastSuccessfulAssistantCount, 0, '没有更早生成快照时必须回退到初始化基线');
assert.deepEqual(baselineRollbackScope.world, valid.scopes.chat.world, '旧数据兼容基线必须保留升级前资料，不能伪造无法重建的初始化内容');
const controllerListeners = [];
const controllerListenerKey = (type, capture = false) => `${type}:${capture ? 'capture' : 'bubble'}`;
const controllerContainer = {
    innerHTML: '',
    addEventListener: (type, listener, capture = false) => controllerListeners.push({ type, listener, capture }),
    removeEventListener: (type, listener, capture = false) => {
        const index = controllerListeners.findIndex(item => item.type === type && item.listener === listener && item.capture === capture);
        assert.notEqual(index, -1, `控制器必须使用原监听器解绑 ${controllerListenerKey(type, capture)}`);
        controllerListeners.splice(index, 1);
    },
    contains: () => true,
};
const controllerState = { phoneWindow: { querySelector: selector => selector === '.pm-today-trend-page' ? controllerContainer : null } };
let controllerCancelReason = '';
let generationListener = null;
let generationUnsubscribeCalls = 0;
let generationReloadCalls = 0;
let controllerStorageId = 'chat';
let controllerStore = valid;
let reloadTodayTrendStore = async () => { generationReloadCalls += 1; return controllerStore; };
let controllerGeneration = { phase: 'idle', task: null };
let controllerCurrentFloor = 3402;
let generationCancelReason = '';
let rejectControllerGeneration = null;
let savedControllerSettings = null;
let initializedControllerOptions = null;
const phoneController = createTodayTrendPhoneController({ state: controllerState, container: controllerContainer, deps: {
    getStorageId: () => controllerStorageId, getTodayTrendStore: async () => controllerStore,
    getCtx: () => ({ chat: [{ mes: 'AI 一' }, { mes: 'AI 二' }] }),
    reloadTodayTrendStore: () => reloadTodayTrendStore(),
    getTodayTrendCurrentFloor: () => controllerCurrentFloor,
    getTodayTrendGenerationState: () => controllerGeneration,
    subscribeTodayTrendGeneration: listener => {
        generationListener = listener;
        listener(controllerGeneration);
        return () => { generationUnsubscribeCalls += 1; };
    },
    generateTodayTrend: () => {
        controllerGeneration = { phase: 'generating', task: { kind: 'manual', storageId: 'chat', floor: 9, target: null } };
        generationListener?.(controllerGeneration);
        return new Promise((_resolve, reject) => { rejectControllerGeneration = reject; });
    },
    cancelTodayTrendGeneration: reason => {
        generationCancelReason = reason;
        controllerGeneration = { phase: 'canceled', task: controllerGeneration.task, lastError: null };
        generationListener?.(controllerGeneration);
        rejectControllerGeneration?.(Object.assign(new Error('今日风向生成已取消'), { name: 'AbortError' }));
        rejectControllerGeneration = null;
    },
    saveTodayTrendSettings: async settings => {
        savedControllerSettings = settings;
        controllerStore = { ...controllerStore, scopes: { ...controllerStore.scopes, chat: { ...controllerStore.scopes.chat, injection: settings.injection } } };
        return controllerStore;
    },
    initializeTodayTrend: async options => { initializedControllerOptions = options; },
    commitTodayTrendScope: async () => valid, cancelTodayTrendInitialization: reason => { controllerCancelReason = reason; },
} });
assert.equal(await phoneController.render(), true, '控制器必须渲染当前聊天的今日风向页面');
assert.match(controllerContainer.innerHTML, /id="pm-today-trend-app"/, '控制器必须渲染今日风向页面壳');
assert.match(controllerContainer.innerHTML, /data-today-trend-floor="3402"[\s\S]*pm-today-trend-floor-value">#3402<\/strong>/, '控制器必须把宿主当前多位楼层完整传给视图');
assert.equal(typeof generationListener, 'function', '控制器创建时必须订阅今日风向生成状态');
const controllerFormData = globalThis.FormData;
globalThis.FormData = class {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values.get(name) ?? null; }
    getAll(name) { const value = this.values.get(name); return Array.isArray(value) ? value : value === undefined ? [] : [value]; }
};
const appSettingsForm = {
    dataset: { todayTrendForm: 'app-settings' },
    values: new Map([['presetId', 'preset'], ['mode', 'auto'], ['intervalFloors', '3'], ['minimalUi', 'on']]),
    matches: selector => selector === 'form[data-today-trend-form]',
};
for (const item of controllerListeners.filter(item => item.type === 'submit')) item.listener({ target: appSettingsForm, preventDefault: () => {} });
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(savedControllerSettings?.injection, { enabled: false, minimalUi: true }, 'APP 总设置提交必须独立保存正文注入与极简 UI 开关');
assert.equal(controllerStore.scopes.chat.injection.minimalUi, true, '极简 UI 设置保存后必须写回当前 scope');
const initializeForm = {
    dataset: { todayTrendForm: 'initialize' },
    values: new Map([['presetName', '初始预设'], ['worldBookNames', ['厨房']], ['includeExistingChat', 'on'], ['backfillExistingChat', 'on'],
        ['recentAssistantCount', '2'], ['mergeAssistantCount', '1'], ['userRequirements', '保留尾部窗口']]),
    matches: selector => selector === 'form[data-today-trend-form]', checkValidity: () => true, reportValidity: () => {},
};
for (const item of controllerListeners.filter(item => item.type === 'submit')) item.listener({ target: initializeForm, preventDefault: () => {} });
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual({ backfillExistingChat: initializedControllerOptions?.backfillExistingChat,
    recentAssistantCount: initializedControllerOptions?.recentAssistantCount, mergeAssistantCount: initializedControllerOptions?.mergeAssistantCount },
{ backfillExistingChat: true, recentAssistantCount: 2, mergeAssistantCount: 1 },
    '初始化控制器必须保留草稿并将回填开关与两个批处理参数透传至安装层');
assert.equal(initializedControllerOptions?.runBackfill, false, '普通初始化不得隐式启动历史批量更新');
globalThis.FormData = controllerFormData;
const controllerCloseSettingsButton = { disabled: false, dataset: { action: 'today-trend-close-settings' }, closest: () => controllerCloseSettingsButton };
controllerListeners.filter(item => item.type === 'click').forEach(item => item.listener({ target: controllerCloseSettingsButton }));
await new Promise(resolve => setTimeout(resolve, 0));
assert.doesNotMatch(controllerContainer.innerHTML, /data-today-trend-form="batch-settings"/, '初始化后的设置页关闭后必须回到内容页，避免污染后续同步状态断言');
const controllerGenerateAllButton = { disabled: false, dataset: { action: 'today-trend-generate-all' }, closest: () => controllerGenerateAllButton };
controllerListeners.filter(item => item.type === 'click').forEach(item => item.listener({ target: controllerGenerateAllButton }));
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(controllerContainer.innerHTML, /today-trend-generate-all" disabled aria-busy="true"/, '当前聊天进入 busy 阶段时必须局部重渲染生成状态');
assert.match(controllerContainer.innerHTML, /data-action="today-trend-cancel-generation"[^>]*><span class="pm-today-trend-floor-reading"><strong class="pm-today-trend-floor-value">#3402<\/strong><\/span><span class="pm-today-trend-floor-status"><i aria-hidden="true"><\/i>同步任务 #9<\/span><\/button>/, '同步中楼层数值与状态文字必须共同位于可点击终止控件内');
const cancelGenerationButton = { disabled: false, dataset: { action: 'today-trend-cancel-generation' } };
controllerListeners.find(item => item.type === 'click' && item.capture)?.listener({
    target: { closest: selector => selector === 'button[data-action]' ? cancelGenerationButton : null },
});
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(generationCancelReason, 'today-trend-user-canceled', '点击同步状态必须调用生成终止能力');
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(controllerContainer.innerHTML, /data-state="canceled"[\s\S]*pm-today-trend-floor-status">已终止<\/span>/, '生成 Promise 抛出 AbortError 后仍必须保留已终止状态，不得被错误报告覆盖为待同步');
controllerGeneration = { phase: 'generating', task: { kind: 'auto', storageId: 'chat', floor: 9, target: null } };
generationListener(controllerGeneration);
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(controllerContainer.innerHTML, /pm-today-trend-progress">正在生成…/, '当前世界态势页必须随生成状态通知刷新现有局部反馈');
controllerGeneration = { phase: 'generating', task: { kind: 'auto', storageId: 'other', floor: 20, target: null } };
generationListener(controllerGeneration);
await new Promise(resolve => setTimeout(resolve, 0));
assert.doesNotMatch(controllerContainer.innerHTML, /同步至 20/, '其他聊天的生成状态不得污染当前页面');
controllerStore = structuredClone(valid);
controllerStore.scopes.chat.world.items[0].summary = '提交后刷新内容';
controllerGeneration = { phase: 'completed', task: { kind: 'auto', storageId: 'chat', floor: 9, target: null } };
generationListener(controllerGeneration);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(generationReloadCalls, 1, '当前聊天完整提交后必须强制重读最新 store');
assert.match(controllerContainer.innerHTML, /提交后刷新内容/, '完整提交后必须渲染重读 store 中的最新业务内容');
let rejectStaleReload;
reloadTodayTrendStore = () => {
    generationReloadCalls += 1;
    return new Promise((resolve, reject) => { rejectStaleReload = reject; });
};
controllerGeneration = { phase: 'completed', task: { kind: 'auto', storageId: 'chat', floor: 10, target: null } };
generationListener(controllerGeneration);
controllerStorageId = 'other';
rejectStaleReload(new Error('旧聊天重读失败'));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(generationReloadCalls, 2, '连续完整提交必须各自触发 store 重读');
assert.doesNotMatch(controllerContainer.innerHTML, /旧聊天重读失败/, '切换聊天后不得显示旧 storageId 的异步重读错误');
assert.deepEqual(controllerListeners.map(item => controllerListenerKey(item.type, item.capture)).sort(), ['change:bubble', 'click:bubble', 'click:capture', 'keydown:bubble', 'submit:bubble', 'submit:bubble'], '控制器必须恰好注册并区分自身与动作分发器的 change、click、submit 与 keydown 代理事件');
assert.equal(phoneController.destroy(), true, '首次销毁控制器必须执行清理');
assert.equal(phoneController.destroy(), false, '重复销毁控制器必须幂等');
assert.equal(controllerCancelReason, 'today-trend-page-destroyed', '销毁控制器必须取消初始化任务');
assert.equal(generationUnsubscribeCalls, 1, '销毁控制器必须且只能解绑一次生成状态订阅');
assert.equal(controllerListeners.length, 0, '销毁控制器必须解绑所有事件代理');
const firstUseHtml = renderTodayTrendApp({ presets: [{ id: 'preset', name: '综艺世界' }], worldBooks: ['厨房设定'] });
assert.match(firstUseHtml, /class="pm-today-trend-init-intro"[^>]*>[\s\S]*?<h3 id="pm-today-trend-init-title" class="pm-today-trend-init-title">创建当前角色的今日风向<\/h3>/, '首次使用必须提供明确的介绍区与三级页面标题');
assert.match(firstUseHtml, /aria-labelledby="pm-today-trend-init-title"/, '初始化页面必须关联可访问标题');
assert.match(firstUseHtml, /复用已有预设，或根据当前世界书创建一套新的今日风向配置。/, '首次使用说明必须同时覆盖复用与创建路径');
assert.match(firstUseHtml, /class="pm-today-trend-mode-switch" aria-label="预设使用方式"/, '存在已有预设时必须提供互斥模式切换控件');

assert.match(firstUseHtml, /data-action="today-trend-use-preset" aria-pressed="true">复用预设<\/button>/, '存在已有预设时必须默认选择复用模式');
assert.match(firstUseHtml, /data-action="today-trend-create-preset" aria-pressed="false">创建预设<\/button>/, '模式切换控件必须提供创建入口');
assert.match(firstUseHtml, /class="pm-today-trend-init-section pm-today-trend-bind-section"/, '已有预设必须形成独立快捷绑定分区');
assert.match(firstUseHtml, /<h4 id="pm-today-trend-bind-title"[^>]*>复用已有预设<\/h4>/, '快捷绑定分区必须提供四级标题');
assert.match(firstUseHtml, /data-today-trend-form="bind-preset"/, '已有预设必须可直接绑定当前聊天');
assert.doesNotMatch(firstUseHtml, /data-today-trend-form="initialize"/, '默认复用模式不得同时平铺创建表单');
assert.match(firstUseHtml, /<button class="pm-today-trend-primary-action" type="submit">绑定并开始<\/button>/, '已有预设快捷区必须保留绑定并开始按钮');
assert.match(firstUseHtml, /name="presetId"/, '复用模式必须保留 presetId 字段');
const createPresetHtml = renderTodayTrendApp({ presets: [{ id: 'preset', name: '综艺世界' }], worldBooks: ['厨房设定'], initializationMode: 'create' });
assert.match(createPresetHtml, /data-action="today-trend-use-preset" aria-pressed="false">复用预设<\/button>/, '创建模式必须取消复用按钮选中态');
assert.match(createPresetHtml, /data-action="today-trend-create-preset" aria-pressed="true">创建预设<\/button>/, '创建模式必须暴露当前选中态');
assert.match(createPresetHtml, /data-today-trend-form="initialize"/, '创建模式必须提供初始化表单');
assert.doesNotMatch(createPresetHtml, /data-today-trend-form="bind-preset"/, '创建模式不得同时平铺复用表单');
for (const name of ['presetName', 'worldBookNames', 'includeExistingChat', 'userRequirements']) {
    assert.match(createPresetHtml, new RegExp(`name="${name}"`), `创建模式必须保留 ${name} 字段`);
}
assert.match(createPresetHtml, /<span>预设名称<\/span>/, '初始化表单必须保留既有预设名称文案');
assert.match(createPresetHtml, /name="backfillExistingChat"[^>]*role="switch"[^>]*aria-checked="false"/, '创建模式必须提供默认关闭的显式历史回填开关');
assert.match(createPresetHtml, /<b>初始化后溯及既往更新<\/b><small>按既有 AI 回复逐批生成历史状态，可能发起多次 AI 请求。<\/small>/,
    '初始化历史回填开关必须明确告知多次 AI 请求副作用');
assert.doesNotMatch(createPresetHtml, /name="recentAssistantCount"|name="mergeAssistantCount"/,
    '初始化历史回填开关关闭时不得渲染批处理参数菜单');
const backfillCreatePresetHtml = renderTodayTrendApp({ worldBooks: ['厨房设定'], assistantCount: 12,
    initializationDraft: { includeExistingChat: true, backfillExistingChat: true, recentAssistantCount: 9, mergeAssistantCount: 3 } });
assert.match(backfillCreatePresetHtml, /name="recentAssistantCount"[^>]*min="1" max="12"[^>]*value="9"/,
    '初始化历史回填开关开启时必须按实时 assistantCount 渲染并保留最近处理层数');
assert.match(backfillCreatePresetHtml, /name="mergeAssistantCount"[^>]*min="1" max="12"[^>]*value="3"/,
    '初始化历史回填开关开启时必须渲染并保留每批合并层数');
assert.match(backfillCreatePresetHtml, /当前聊天 AI 回复累计层数<\/span><b>12<\/b>/,
    '初始化历史回填参数必须按统计行显示尾部窗口层数');
const emptyBackfillCreatePresetHtml = renderTodayTrendApp({ worldBooks: ['厨房设定'], assistantCount: 0,
    initializationDraft: { includeExistingChat: true, backfillExistingChat: true } });
assert.doesNotMatch(emptyBackfillCreatePresetHtml, /data-action="today-trend-initialize-and-batch"/,
    '初始化历史回填开关开启但没有 AI 回复时不得展示不可执行的手动批量更新入口');

const emptyWorldBooksHtml = renderTodayTrendApp({ worldBooks: [] });
assert.doesNotMatch(emptyWorldBooksHtml, /pm-today-trend-mode-switch/, '无已有预设时不得展示无效的复用切换入口');
assert.match(emptyWorldBooksHtml, /data-today-trend-form="initialize"/, '无已有预设时必须直接展示创建表单');
assert.match(emptyWorldBooksHtml, /class="pm-today-trend-empty-state" role="status">当前聊天没有可用世界书，无法初始化。<\/p>/, '无世界书时必须显示明确空状态');
assert.match(emptyWorldBooksHtml, /class="pm-today-trend-primary-action" type="submit" disabled aria-busy="false">生成<\/button>/, '无世界书时生成按钮必须保持禁用');
const initializingHtml = renderTodayTrendApp({ worldBooks: ['厨房设定'], initializing: true,
    initializationDraft: { presetName: '处理中', worldBookNames: ['厨房设定'], includeExistingChat: true, userRequirements: '保留草稿' } });
assert.match(initializingHtml, /class="pm-today-trend-primary-action" type="submit" disabled aria-busy="true">正在初始化今日风向<\/button>/, '初始化中按钮必须禁用并暴露忙碌状态');
assert.match(initializingHtml, /value="处理中"/, '初始化中必须保持表单草稿可见');
assert.match(initializingHtml, /class="pm-today-trend-init-feedback pm-today-trend-loading" role="status" aria-live="polite">正在初始化今日风向/, '初始化中必须提供稳定的状态反馈');
const failedInitializationHtml = renderTodayTrendApp({ presets: [{ id: 'preset', name: '综艺世界' }], worldBooks: ['厨房设定', '节目规则'], error: '初始化失败',
    initializationMode: 'create', initializationDraft: { presetName: '晚间赛制', worldBookNames: ['节目规则'], includeExistingChat: false, userRequirements: '保留淘汰规则' } });
assert.match(failedInitializationHtml, /value="晚间赛制"/, '初始化失败后必须保留预设名称草稿');
assert.match(failedInitializationHtml, /value="节目规则" checked/, '初始化失败后必须保留世界书选择');
assert.doesNotMatch(failedInitializationHtml, /name="includeExistingChat" type="checkbox" checked/, '初始化失败后必须保留正文开关');
assert.match(failedInitializationHtml, /关闭后，仅依据已选世界书、角色资料和当前追踪状态独立推演 NPC 群像。/, '正文开关必须解释关闭后的通用 NPC 独立推演语义');
assert.match(failedInitializationHtml, /保留淘汰规则/, '初始化失败后必须保留追加要求');
assert.match(failedInitializationHtml, /class="pm-today-trend-init-feedback pm-today-trend-error" role="alert">初始化失败<\/p>/, '初始化错误必须保留 alert 语义并位于反馈区');
const appHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), generation: { phase: 'idle' } });
for (const label of ['世界态势', '个人风评', '势力图谱', '事件追踪']) assert.match(appHtml, new RegExp(label), `主页面必须装配${label}`);
assert.doesNotMatch(appHtml, /<h2\b[^>]*\bid="pm-today-trend-title"/, '模块页顶栏采纳上游无标题形式');
assert.doesNotMatch(appHtml, /aria-labelledby="[^"]*\bpm-today-trend-title\b[^"]*"/, '不得悬空引用已移除的顶栏标题');
assert.match(appHtml, /<section\b[^>]*\bid="pm-today-trend-app"[^>]*\baria-label="今日风向"/, '今日风向 section 必须保留可访问名称');
const minimalAppScope = structuredClone(valid.scopes.chat);
minimalAppScope.injection.minimalUi = true;
const minimalAppHtml = renderTodayTrendApp({ scope: minimalAppScope, presets: Object.values(valid.presets), view: { name: 'reputation', mode: 'content' }, generation: { phase: 'idle' } });
assert.match(minimalAppHtml, /pm-today-trend-content is-reputation is-minimal-ui/, '极简 UI 开启时内容容器必须提供隔离样式钩子');
const multiDigitFloorHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name: 'world', mode: 'content' }, generation: { phase: 'idle' }, currentFloor: 3000 });
assert.match(multiDigitFloorHtml, /data-today-trend-floor="3000"[\s\S]*aria-label="楼层 #3000，待同步"[\s\S]*pm-today-trend-floor-value">#3000<\/strong>/, '宿主多位楼层必须从数据属性到可见数值完整渲染，不能截断或退回内部统计');
const rolledBackFloorHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name: 'world', mode: 'content' }, generation: { phase: 'idle' }, currentFloor: 3 });
assert.match(rolledBackFloorHtml, /data-today-trend-floor="3" data-state="unsynced"[\s\S]*pm-today-trend-floor-value">#3<\/strong>[\s\S]*pm-today-trend-floor-status">待同步<\/span>/, '宿主楼层低于旧 checkpoint 时不得误报已同步');
const unavailableFloorHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name: 'world', mode: 'content' }, generation: { phase: 'idle' }, currentFloor: null });
assert.match(unavailableFloorHtml, /data-today-trend-floor="" data-state="unavailable"[\s\S]*pm-today-trend-floor-value">#--<\/strong>[\s\S]*楼层不可用/, '宿主楼层不可用时不得把内部助手统计冒充真实楼层');
for (const name of ['world', 'reputation', 'faction', 'dynamics']) {
    const floorHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name, mode: 'content' }, generation: { phase: 'idle' } });
    assert.match(floorHtml, /data-today-trend-floor="7" data-state="synced" role="status" aria-live="polite"/, `${name} 内容页必须展示已同步楼层仪表`);
    assert.match(floorHtml, /pm-today-trend-floor-value">#7<\/strong>/, `${name} 内容页必须使用 #N 语义结构`);
    assert.match(floorHtml, /pm-today-trend-floor-status">已同步<\/span>/, `${name} 内容页空闲时必须展示已同步状态`);
}
const updatingFloorHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name: 'reputation', mode: 'content' },
    generation: { phase: 'generating', task: { kind: 'auto', storageId: 'chat', floor: 12, target: null } }, currentFloor: 13 });
assert.match(updatingFloorHtml, /data-today-trend-floor="13" data-state="updating"/, '完整更新中楼层主值必须继续展示当前宿主楼层');
assert.match(updatingFloorHtml, /同步任务 #12/, '宿主继续增长时必须把生成目标明确标为任务楼层，不能伪装成当前楼层');
assert.doesNotMatch(updatingFloorHtml, /pm-today-trend-floor-value">#12<\/strong>/, '尚未提交的目标楼层不得冒充当前楼层主值');
const failedFloorHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name: 'reputation', mode: 'content' },
    generation: { phase: 'failed', task: { kind: 'auto', storageId: 'chat', floor: 12, target: null }, lastError: 'AI 请求失败' }, currentFloor: 12 });
assert.match(failedFloorHtml, /data-state="failed"[\s\S]*pm-today-trend-floor-status" title="AI 请求失败">同步失败<\/span>/, '生成失败后必须显示同步失败并保留错误说明');
const escapedFailureHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name: 'reputation', mode: 'content' },
    generation: { phase: 'failed', task: { kind: 'auto', storageId: 'chat', floor: 12, target: null }, lastError: '"失败" <script> & more' }, currentFloor: 12 });
assert.match(escapedFailureHtml, /title="&quot;失败&quot; &lt;script&gt; &amp; more"/, '同步失败说明必须按 HTML 属性语境转义');
assert.doesNotMatch(escapedFailureHtml, /<script>/, '同步失败说明不得注入标签');
const canceledFloorHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name: 'reputation', mode: 'content' },
    generation: { phase: 'canceled', task: { kind: 'auto', storageId: 'chat', floor: 12, target: null }, lastError: null }, currentFloor: 12 });
assert.match(canceledFloorHtml, /data-state="canceled"[\s\S]*pm-today-trend-floor-status">已终止<\/span>/, '主动终止后必须显示已终止而非待同步');
const targetedFloorHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name: 'faction', mode: 'content' },
    generation: { phase: 'parsing', task: { kind: 'manual', storageId: 'chat', floor: 99, target: { module: 'faction', itemId: 'red' } } } });
assert.match(targetedFloorHtml, /data-today-trend-floor="7" data-state="updating"/, '定向刷新必须保留已提交楼层主值');
assert.match(targetedFloorHtml, /正在更新模块/, '定向刷新必须使用模块更新文案');
assert.doesNotMatch(targetedFloorHtml, /同步至 99|pm-today-trend-floor-value">#99<\/strong>/, '定向刷新不得虚假推进或承诺楼层 checkpoint');
for (const view of [{ name: 'settings' }, { name: 'faction', mode: 'editor', editingFactionId: 'red' }, { name: 'world', editingRule: 'world' }]) {
    assert.doesNotMatch(renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view }), /data-today-trend-floor=/, '设置、编辑和规则页不得展示楼层仪表');
}
assert.match(appHtml, /today-trend-open-settings/, '主页面必须提供 APP 总设置入口');
assert.doesNotMatch(appHtml, /today-trend-open-batch-settings|手动批量更新历史楼层/,
    '顶栏不得提供错误归属的批量更新入口');
assert.match(appHtml, /data-action="today-trend-generate-all"[^>]*aria-label="手动更新所有今日风向"/,
    '主页面单次生成入口不得被批量更新功能替换');
const firstUseAppHtml = renderTodayTrendApp({ worldBooks: ['厨房设定'] });
assert.match(firstUseAppHtml, /data-action="today-trend-open-settings"[^>]*aria-label="APP 总设置"/,
    '首次创建页必须提供 APP 总设置入口');
assert.match(renderTodayTrendApp({ worldBooks: ['厨房设定'], view: { name: 'settings' } }), /请先创建或绑定世界预设。/,
    '首次创建页的 APP 总设置入口必须能打开无 scope 设置页');
assert.match(appHtml, /today-trend-generate-all[^>]*aria-busy="false"[^>]*aria-label="手动更新所有今日风向"/, '主页面必须提供手动更新全部今日风向的星光按钮');
assert.match(appHtml, /today-trend-toggle-operation[\s\S]*aria-pressed="true"/, '主页面必须提供当前运行状态的直接控制');
assert.ok(appHtml.indexOf('today-trend-generate-all') < appHtml.indexOf('today-trend-toggle-operation'), '顶栏操作顺序必须为生成、开启自动');
assert.doesNotMatch(appHtml, /pm-today-trend-close|data-today-trend-ui-action="close"|aria-label="关闭手机"/, '今日风向顶栏不得提供关闭手机按钮');
const busyAppHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), generation: { phase: 'generating' } });
assert.match(busyAppHtml, /today-trend-generate-all" disabled aria-busy="true"/, '全量生成中必须禁用顶栏手动更新按钮并暴露忙碌状态');
const rulePageHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), view: { name: 'world', mode: 'rule-editor', editingRule: 'world' } });
assert.match(rulePageHtml, /pm-today-trend-rule-page/, '提示词编辑必须打开独立页面容器');
assert.match(rulePageHtml, /提示词<textarea/, '独立提示词页面必须使用中文字段名');
assert.doesNotMatch(rulePageHtml, /PROMPT EDITOR|世界态势 Prompt|pm-today-trend-rule-page-head/, '独立提示词页面不得保留多余英文或页面标题');
assert.match(rulePageHtml, /data-today-trend-form="rule-editor"/, '独立提示词页面必须复用规则保存表单契约');
assert.match(rulePageHtml, /textarea[^>]*name="text"[^>]*autofocus/, '独立提示词页面必须直接聚焦编辑框');
assert.match(rulePageHtml, /<button type="button" data-action="today-trend-cancel-rule-editor">返回<\/button><button type="submit">保存提示词<\/button>/, '独立提示词页面必须提供返回与保存提示词操作');
assert.doesNotMatch(rulePageHtml, /aria-label="今日风向模块"/, '独立提示词页面不得继续显示底部模块导航');
const reinitializeHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), worldBooks: ['厨房设定'], initializationOpen: true, reinitializing: true });
assert.match(reinitializeHtml, /重新初始化当前今日风向/, '重新初始化必须复用两步初始化表单');
assert.match(reinitializeHtml, /选择用于重新生成规则与初始资料的世界书。/, '重新初始化必须提供与替换流程一致的说明');
assert.match(reinitializeHtml, /today-trend-cancel-initialize/, '重新初始化必须允许安全取消');
assert.doesNotMatch(reinitializeHtml, /data-today-trend-form="bind-preset"/, '重新初始化不得混入快捷绑定表单');
assert.doesNotMatch(reinitializeHtml, /pm-today-trend-mode-switch/, '重新初始化不得暴露模式切换控件');
assert.match(reinitializeHtml, /class="pm-today-trend-secondary-action" type="button" data-action="today-trend-cancel-initialize">取消<\/button>/, '重新初始化取消必须保持次操作语义');
assert.match(todayTrendStyle, /pm-today-trend-mode-switch\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[^}]*background:var\(--pm-color-surface-control\)/, '预设模式切换必须保持双列分段布局和控件表面语义');
assert.match(todayTrendStyle, /pm-today-trend-mode-switch button\[aria-pressed="true"\]\{[^}]*background:var\(--pm-color-accent\)[^}]*color:var\(--pm-color-on-accent\)/, '预设模式选中项必须使用 accent 与 on-accent 语义色');
assert.match(todayTrendStyle, /pm-today-trend-first-use \.pm-today-trend-init-actions button,\.pm-today-trend-first-use \.pm-today-trend-bind-form>button\{[^}]*width:100%[^}]*min-height:var\(--pm-size-control-default\)[^}]*place-items:center[^}]*text-align:center/, '初始化页主按钮必须全宽、使用默认控件高度并居中文本');
assert.match(todayTrendStyle, /pm-today-trend-first-use \.pm-today-trend-primary-action\{[^}]*background:var\(--pm-color-accent\)[^}]*color:var\(--pm-color-on-accent\)/, '初始化页主按钮必须使用 accent 与 on-accent 语义色');
assert.match(todayTrendStyle, /pm-today-trend-first-use \.pm-today-trend-secondary-action\{[^}]*background:var\(--pm-color-surface-control\)[^}]*color:var\(--pm-color-text-primary\)/, '重新初始化取消按钮不得获得主操作视觉权重');
assert.match(todayTrendStyle, /pm-today-trend-first-use \.pm-today-trend-init-actions\{flex-direction:column;flex-wrap:nowrap;?\}/, '初始化操作区必须上下排列按钮');
const initializationActionRule = todayTrendStyle.match(/\.pm-today-trend-first-use \.pm-today-trend-init-actions\{[^}]*\}/)?.[0] || '';
assert.doesNotMatch(initializationActionRule, /position:(?:absolute|fixed)|bottom:/, '初始化操作区必须保持正常文档流');
assert.match(todayTrendStyle, /pm-today-trend-first-use \.pm-today-trend-book-option span\{[^}]*overflow-wrap:anywhere/, '长世界书名称必须安全换行');
assert.match(todayTrendStyle, /@media\(max-width:320px\)\{\.pm-today-trend-first-use/, '初始化页面必须提供 320px 窄屏规则');
assert.match(todayTrendStyle, /pm-today-trend-rule-editor>\.pm-today-trend-form-actions\{[^}]*display:grid[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, '提示词返回与保存操作必须左右等分占满可用宽度');
assert.match(todayTrendStyle, /pm-today-trend-rule-editor \.pm-today-trend-form-actions button\[type="submit"\]\{[^}]*background:var\(--pm-color-accent\)[^}]*color:var\(--pm-color-on-accent\)/, '保存提示词必须保持主操作语义色');
const appSettingsHtml = renderTodayTrendSettingsView({ scope: valid.scopes.chat, presets: Object.values(valid.presets) });
for (const name of ['presetId', 'mode', 'intervalFloors', 'injectionEnabled', 'minimalUi']) assert.match(appSettingsHtml, new RegExp(`name="${name}"`), `APP 总设置必须提供 ${name}`);
assert.match(appSettingsHtml, /自动调用：每 N 楼执行一次/, '自动推进设置必须明确每 N 楼执行一次');
assert.ok(appSettingsHtml.indexOf('name="injectionEnabled"') < appSettingsHtml.indexOf('name="minimalUi"'), '极简 UI 开关必须位于正文注入开关之后');
assert.match(appSettingsHtml, /name="minimalUi" type="checkbox" role="switch" aria-checked="false"/, '极简 UI 开关必须暴露关闭状态语义');
assert.match(todayTrendStyle, /\.pm-today-trend-injection-switch b,\.pm-today-trend-minimal-ui-switch b,\.pm-today-trend-batch-switch b\{font-size:var\(--pm-font-size-label\)/, '极简 UI 标题必须与正文注入标题使用相同标签字号');
assert.match(todayTrendStyle, /\.pm-today-trend-injection-switch>span,\.pm-today-trend-minimal-ui-switch>span,\.pm-today-trend-batch-switch>span\{display:flex;min-width:0;flex-direction:column;gap:var\(--pm-space-0-5\)/, '极简 UI 标题与说明必须和正文注入一样纵向排列');
assert.match(todayTrendStyle, /\.pm-today-trend-injection-switch small,\.pm-today-trend-minimal-ui-switch small,\.pm-today-trend-batch-switch small\{color:var\(--pm-color-text-tertiary\);font-size:var\(--pm-font-size-helper\);line-height:var\(--pm-line-height-body\)/, '极简 UI 说明文字必须与正文注入使用相同字号、行高和颜色');
assert.match(todayTrendStyle, /\.pm-today-trend-injection-switch,\.pm-today-trend-minimal-ui-switch,\.pm-today-trend-batch-switch\{padding:var\(--pm-space-px-7\) var\(--pm-space-0-5\);border:0;background:transparent;text-align:left\}/, '极简 UI 条目必须与正文注入使用相同内边距和容器样式');
assert.match(todayTrendStyle, /\.pm-today-trend-minimal-ui-switch>i\{width:var\(--pm-today-trend-switch-width\);height:var\(--pm-today-trend-switch-height\);flex:0 0 var\(--pm-today-trend-switch-width\);/, '极简 UI 开关轨道必须使用与正文注入等值的尺寸 token');
assert.match(todayTrendStyle, /\.pm-today-trend-minimal-ui-switch>i::after\{top:calc\(\(var\(--pm-today-trend-switch-height\) - var\(--pm-today-trend-switch-knob\)\) \/ 2\);left:calc\(\(var\(--pm-today-trend-switch-height\) - var\(--pm-today-trend-switch-knob\)\) \/ 2\);width:var\(--pm-today-trend-switch-knob\);height:var\(--pm-today-trend-switch-knob\);/, '极简 UI 开关滑块必须使用与正文注入等值的尺寸和初始位置 token');
assert.match(todayTrendStyle, /\.pm-today-trend-minimal-ui-switch input:checked\+i::after\{transform:translateX\(calc\(var\(--pm-today-trend-switch-width\) - var\(--pm-today-trend-switch-height\)\)\)/, '极简 UI 开关启用位移必须使用与正文注入等值的尺寸 token');
for (const action of ['today-trend-new-preset', 'today-trend-reinitialize', 'today-trend-delete-preset']) assert.match(appSettingsHtml, new RegExp(action), `APP 总设置必须提供 ${action}`);
for (const [menuOpenId, action] of [['app-rule:world', 'today-trend-edit-world-rule'], ['app-rule:underground', 'today-trend-edit-underground-rule']]) {
    assert.match(renderTodayTrendSettingsView({ scope: valid.scopes.chat, presets: Object.values(valid.presets), menuOpenId }), new RegExp(action), `APP 总设置展开对应动作条后必须提供 ${action}`);
}
assert.doesNotThrow(() => renderTodayTrendSettingsView(), '总设置视图不得保留占位异常');
const closedMenuHtml = trendActionMenu({ id: 'world-module', label: '世界态势操作', actions: [{ action: 'test-action', icon: '<svg></svg>', label: '测试操作' }] });
assert.match(closedMenuHtml, /aria-expanded="false"/, '关闭态动作条必须暴露收起状态');
assert.doesNotMatch(closedMenuHtml, /is-open|test-action/, '关闭态不得渲染隐藏动作或打开样式');
assert.match(closedMenuHtml, /today-trend-toggle-menu/, '关闭态必须提供展开操作的省略号按钮');
const openMenuHtml = trendActionMenu({ id: 'world-module', open: true, label: '世界态势操作', actions: [{ action: 'test-action', icon: '<svg></svg>', label: '测试操作' }] });
assert.match(openMenuHtml, /is-open/, '打开态动作条必须标识展开样式');
assert.doesNotMatch(openMenuHtml, /today-trend-toggle-menu|aria-expanded="true"/, '打开态不得保留重复的省略号按钮');
assert.match(openMenuHtml, /test-action/, '打开态必须渲染横向动作');
assert.match(openMenuHtml, /pm-today-trend-menu-close[^>]*data-action="today-trend-close-menu"[^>]*aria-label="关闭编辑模式"/, '打开态动作组必须提供关闭编辑模式按钮');
assert.ok(openMenuHtml.indexOf('test-action') < openMenuHtml.indexOf('pm-today-trend-menu-close'), '关闭编辑模式按钮必须位于展开动作组最右端');
const closedInlineActionsHtml = trendInlineActions({ actions: [{ action: 'test-inline-action', icon: '<svg></svg>', label: '测试行内操作' }] });
assert.equal(closedInlineActionsHtml, '', '顶级操作条关闭时必须隐藏下方行内动作');
const openInlineActionsHtml = trendInlineActions({ visible: true, actions: [{ action: 'test-inline-action', icon: '<svg></svg>', label: '测试行内操作' }] });
assert.match(openInlineActionsHtml, /pm-today-trend-inline-actions/, '顶级操作条打开时必须输出行内动作容器');
assert.match(openInlineActionsHtml, /test-inline-action/, '顶级操作条打开时必须输出下方行内动作');
assert.doesNotMatch(openInlineActionsHtml, /today-trend-toggle-menu/, '下方行内动作不得重复渲染省略号或关闭按钮');
const ruleEditorHtml = trendRuleEditor({ rule: 'world', value: '世界规则' });
assert.match(ruleEditorHtml, /data-today-trend-form="rule-editor"/, '规则编辑页必须使用既有保存表单契约');
assert.match(ruleEditorHtml, /name="rule" value="world"/, '规则编辑必须携带规则标识');
assert.match(ruleEditorHtml, /提示词<textarea[^>]*name="text"[^>]*required autofocus/, '规则编辑必须使用中文字段名、要求非空并自动聚焦');
assert.match(ruleEditorHtml, /textarea class="pm-today-trend-input" name="text"/, '规则编辑提示词必须复用统一输入控件配方');
assert.match(todayTrendCoreStyle, /\.pm-today-trend-rule-editor textarea\)\{font-size:var\(--pm-font-size-compact\)!important;/, '规则编辑提示词必须使用 13px 紧凑字号 token');
assert.match(ruleEditorHtml, />返回<\/button><button type="submit">保存提示词<\/button>/, '规则编辑必须使用中文操作文案');
assert.doesNotMatch(ruleEditorHtml, /Prompt|PROMPT/, '规则编辑可见文案不得残留英文 Prompt');
const worldHtml = renderTodayTrendWorldView({ scope: valid.scopes.chat, generationAvailable: true, menuOpenId: 'world-module' });
const worldHeaderHtml = renderTodayTrendWorldView({ scope: valid.scopes.chat, generationAvailable: true, menuOpenId: 'world-module', floorStatus: '<span data-today-trend-floor="7"></span>' });
const worldPanelsScope = { ...valid.scopes.chat, world: { items: [...valid.scopes.chat.world.items, { id: 'world-brief', name: '后勤消息', summary: '补给已抵达' }, { id: 'world-terminal', name: '航线警报', summary: '航线出现扰动' }] } };
const worldPanelsHtml = renderTodayTrendWorldView({ scope: worldPanelsScope });
const worldPanelsMenuHtml = renderTodayTrendWorldView({ scope: worldPanelsScope, generationAvailable: true, menuOpenId: 'world-module' });
assert.match(worldHtml, /编辑世界态势提示词/, '世界态势入口必须使用中文提示词文案');
assert.doesNotMatch(worldHtml, /编辑世界态势 Prompt/, '世界态势入口不得残留英文 Prompt');
const worldHeadHtml = worldHeaderHtml.slice(worldHeaderHtml.indexOf('<header class="pm-today-trend-module-head'), worldHeaderHtml.indexOf('</header>') + '</header>'.length);
assert.match(worldHeadHtml, /pm-today-trend-module-head is-expanded/, '世界态势必须使用固定的大色块模块头');
assert.ok(worldHeadHtml.indexOf('<h2>世界态势</h2>') < worldHeadHtml.indexOf('today-trend-generate-world')
    && worldHeadHtml.indexOf('today-trend-generate-world') < worldHeadHtml.indexOf('today-trend-edit-world-rule')
    && worldHeadHtml.indexOf('today-trend-edit-world-rule') < worldHeadHtml.indexOf('today-trend-toggle-menu'),
    '世界态势模块头必须先居中输出标题，再按刷新、提示词、条目操作的顺序输出三个图标按钮');
assert.match(worldHeadHtml, /<h2>[\s\S]*?<\/h2>[\s\S]*?data-today-trend-floor/, '世界态势楼层状态必须位于标题右侧');
const worldMeterHtml = worldHeadHtml.slice(worldHeadHtml.indexOf('pm-today-trend-meter'), worldHeadHtml.indexOf('<h2>世界态势</h2>'));
assert.doesNotMatch(worldMeterHtml, /<svg|TREND_METER_CLOCK/, '世界态势元数据不得保留时钟图标');
assert.doesNotMatch(todayTrendUiText, /TREND_METER_CLOCK_ICON_SVG/, '仪表盘渲染器不得保留时钟图标常量');
assert.match(worldHtml, /pm-today-trend-module-head[\s\S]*?<\/header><div class="pm-today-trend-module-body">/, '世界态势必须将主题色模块头与灰色内容层拆为相邻容器');
assert.match(worldHtml, /节目风向/, '世界态势页必须渲染初始化生成的世界观项目');
assert.doesNotMatch(worldPanelsHtml, /data-menu-id="world:/, '世界态势摘要常态不得渲染省略号入口');
for (const article of worldPanelsHtml.match(/<article class="pm-today-trend-world-(?:hero|brief)[\s\S]*?<\/article>/g) || []) assert.doesNotMatch(article, /today-trend-toggle-menu|aria-expanded=|data-menu-id=/, '世界态势摘要自身不得包含省略号菜单触发器');
assert.match(worldHtml, /data-world-item-id="world"[\s\S]*?pm-today-trend-world-item-head[\s\S]*?pm-today-trend-inline-actions[\s\S]*?today-trend-refresh-world-item/, '打开模块操作后必须以内联动作提供顶部摘要刷新入口');
for (const itemId of ['world', 'world-brief', 'world-terminal']) assert.match(worldPanelsMenuHtml, new RegExp(`data-world-item-id="${itemId}"[\\s\\S]*?pm-today-trend-inline-actions[\\s\\S]*?today-trend-refresh-world-item[\\s\\S]*?today-trend-edit-world-item[\\s\\S]*?today-trend-delete-world-item`), `打开模块操作后必须为 ${itemId} 提供完整内联操作`);
assert.equal((worldPanelsMenuHtml.match(/pm-today-trend-inline-actions/g) || []).length, 3, '世界态势模块菜单展开后必须为每条摘要提供一组内联操作');
assert.doesNotMatch(worldPanelsHtml, /pm-today-trend-world-panel/, '世界态势摘要不得套用方角内容容器');
assert.doesNotMatch(worldPanelsHtml, /pm-today-trend-world-(?:ornament|left-ornament|terminal|dotfield)/, '世界态势摘要不得保留旧装饰节点');
assert.doesNotMatch(worldHtml, /WORLD SITUATION|pm-today-trend-world-(?:title-rail|title-dotfield|kicker|starfield)/, '世界态势不得保留旧标题轨或星图装饰');
assert.doesNotMatch(worldHtml, /pm-today-trend-world-(?:head|foot)-art/, '世界态势不得渲染头尾装饰 SVG');
assert.match(worldPanelsHtml, /pm-today-trend-world-hero"/, '世界态势必须渲染主摘要卡片');
assert.match(worldPanelsHtml, /pm-today-trend-world-signals/, '世界态势次级摘要必须位于信号流容器');
assert.match(worldPanelsHtml, /pm-today-trend-world-signal-marker[^>]*data-today-trend-icon="[^"]+"[^>]*aria-hidden="true"><svg[\s\S]*?<\/svg><\/span>/, '世界态势卡片必须输出带 key 的 SVG 主题节点');
assert.doesNotMatch(worldPanelsHtml, /pm-today-trend-world-signal-marker[^>]*><i><\/i><\/span>/, '世界态势卡片不得回退为裸 i 圆点');
const titleIconCases = [
    ['暴雨侵袭港口航线', 'weather-storm'], ['暴雪封锁山路', 'weather-snow'], ['大雾笼罩机场', 'weather-fog'],
    ['晴天热浪来袭', 'weather-sun'], ['多云天气转晴', 'weather-partly-cloudy'], ['阴云压境', 'weather-cloud'],
    ['港口签署通航协议', 'document'], ['城市辟谣发布会', 'rumor'], ['机场联络窗口开放', 'signal'],
    ['年度峰会日程', 'calendar'], ['新产品发布会直播', 'live'], ['恋情公开告白', 'heart'],
    ['机场路线迁移', 'location'], ['观众情绪变化', 'community'], ['寒潮天气预警', 'weather'],
    ['节目风向变化', 'trend'], ['实验发现突破', 'sparkles'], ['晚餐服务安排', 'recipe'],
    ['秋季时装秀场', 'outfit'], ['旧案历史回顾', 'time'],
];
assert.equal(TODAY_TREND_TITLE_ICON_TOPICS.length, 20, '标题语义目录必须固定为 20 个 topic');
assert.equal(new Set(TODAY_TREND_TITLE_ICON_TOPICS.map(topic => topic.key)).size, 20, '标题语义目录 key 必须唯一');
assert.deepEqual(titleIconCases.map(([, key]) => key), TODAY_TREND_TITLE_ICON_TOPICS.map(topic => topic.key), '正例必须覆盖目录全部 topic 且保持优先级顺序');
const titleNamingGuide = todayTrendTitleNamingGuide();
assert.match(titleNamingGuide, /仅在事实确实适配时/);
assert.match(titleNamingGuide, /不要为了图标硬塞无关词/);
assert.match(titleNamingGuide, /未分类主题可以保持自然命名/);
assert.doesNotMatch(titleNamingGuide, /<svg|world-default|event-(?:incident|underground|normal)/, '命名指南不得泄漏 SVG 或 resolver fallback 实现');
for (const [title, expectedKey] of titleIconCases) {
    const resolved = resolveTodayTrendTitleIcon({ title, kind: 'world' });
    assert.equal(resolved.key, expectedKey, `标题 ${title} 必须映射到 ${expectedKey}`);
    assert.match(resolved.svg, /<svg[\s\S]*stroke="currentColor"/, `topic ${expectedKey} 必须绑定 currentColor SVG`);
}
for (const [title, expectedKey] of [
    ['暴雨侵袭港口航线', 'weather-storm'], ['港口签署通航协议', 'document'],
    ['城市辟谣发布会', 'rumor'], ['机场联络窗口开放', 'signal'], ['新区发展趋势报告', 'document'],
]) assert.equal(resolveTodayTrendTitleIcon({ title, kind: 'world' }).key, expectedKey, `冲突标题 ${title} 必须遵守固定优先级`);
assert.equal(resolveTodayTrendTitleIcon({ title: ' 　暴雨　', kind: 'world' }).key, 'weather-storm', '标题标准化必须处理全角空白与 NFKC 输入');
assert.equal(resolveTodayTrendTitleIcon({ title: '', kind: 'world' }).key, 'world-default', '世界态势空标题必须回退默认图标');
assert.equal(resolveTodayTrendTitleIcon({ title: '未登记的标题', kind: 'world' }).key, 'world-default', '世界态势未知标题必须回退默认图标');
assert.equal(resolveTodayTrendTitleIcon({ title: '', kind: 'event', type: 'incident' }).key, 'event-incident', '事件突发类型必须提供类型图标兜底');
assert.equal(resolveTodayTrendTitleIcon({ title: '', kind: 'event', type: 'rumor' }).key, 'rumor', '事件流言类型必须提供流言图标兜底');
assert.equal(resolveTodayTrendTitleIcon({ title: '', kind: 'event', type: 'underground' }).key, 'event-underground', '事件地下线类型必须提供类型图标兜底');
assert.equal(resolveTodayTrendTitleIcon({ title: '', kind: 'event', type: 'unknown' }).key, 'event-normal', '未知事件类型必须回退普通事件图标');
const sharedTitleWorldIcon = resolveTodayTrendTitleIcon({ title: '港口签署通航协议', kind: 'world' });
const sharedTitleEventIcon = resolveTodayTrendTitleIcon({ title: '港口签署通航协议', kind: 'event', type: 'incident' });
assert.deepEqual(sharedTitleEventIcon, sharedTitleWorldIcon, '相同标题在世界态势与事件追踪中必须得到相同图标映射');
const titlePriorityScope = structuredClone(valid.scopes.chat);
titlePriorityScope.dynamics.active[0] = { ...titlePriorityScope.dynamics.active[0], type: 'incident', title: '港口签署通航协议', origin: '暴雨公告联络均不参与图标判断' };
const titlePriorityHtml = renderTodayTrendDynamicsView({ scope: titlePriorityScope });
assert.match(titlePriorityHtml, /data-event-id="service"[\s\S]*?data-today-trend-icon="document"/, '标题命中必须优先于事件 type');
assert.match(titlePriorityHtml, /data-event-id="service"[\s\S]*?pm-today-trend-event-badge">突发/, '标题图标变化不得移除事件 type badge');
assert.match(sharedTitleEventIcon.svg, /stroke="currentColor"/, '映射 SVG 必须使用 currentColor 前景');
const ignoredFieldsScope = structuredClone(valid.scopes.chat);
ignoredFieldsScope.world.items[0] = { ...ignoredFieldsScope.world.items[0], name: '未登记标题', summary: '暴雨公告联络港口观众风向后厨消息晴天' };
ignoredFieldsScope.dynamics.active[0] = { ...ignoredFieldsScope.dynamics.active[0], title: '未登记标题', type: 'normal', origin: '暴雨公告联络港口观众风向后厨消息晴天', latestStage: '暴雨公告联络港口观众风向后厨消息晴天', participants: ['暴雨公告联络港口观众风向后厨消息晴天'] };
const ignoredWorldHtml = renderTodayTrendWorldView({ scope: ignoredFieldsScope });
const ignoredDynamicsHtml = renderTodayTrendDynamicsView({ scope: ignoredFieldsScope });
assert.match(ignoredWorldHtml, /data-world-item-id="world"[\s\S]*?data-today-trend-icon="world-default"/, '世界态势映射不得扫描 summary 等非标题字段');
assert.match(ignoredDynamicsHtml, /data-event-id="service"[\s\S]*?data-today-trend-icon="event-normal"/, '事件映射不得扫描 origin、latestStage 或 participants');

assert.doesNotMatch(worldPanelsHtml, /pm-today-trend-world-brief-tail|\bis-(?:left|right)\b/, '世界态势卡片不得保留尾线或左右轨道布局类');
assert.match(worldHtml, /pm-today-trend-meter[\s\S]*?SIGNALS[\s\S]*?BRIEFS/, '世界态势 meta 必须用英文装饰标签映射真实项目与摘要数量');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-world-(?:signals::before|hero\.has-signals::after|brief\.is-right::after)/, '世界态势不得恢复连续轨道线');
assert.match(todayTrendStyle, /pm-today-trend-world \.pm-today-trend-meter\{margin-top:var\(--pm-today-trend-world-meta-offset\)/, '世界态势 meta 与标题的间距必须由原型映射 token 控制');
assert.match(todayTrendStyle, /pm-today-trend-world\{flex:0 0 auto;gap:var\(--pm-space-0\);padding:var\(--pm-space-0\) var\(--pm-space-0\) var\(--pm-space-0\)/, '世界态势主题色标题层必须全宽，横向留白只归灰色内容层');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-world\{[^}]*padding:var\(--pm-space-0\)/, '世界态势内容容器必须零内距，安全区由灰色内容层承担');
assert.match(todayTrendStyle, /--pm-today-trend-report-title-size:calc\(var\(--pm-font-size-title\) \+ var\(--pm-space-2\)\)/, '其他三个模块的大标题必须使用收紧后的统一字号');
assert.match(todayTrendStyle, /--pm-today-trend-world-title-size:calc\(var\(--pm-font-size-title\) \+ var\(--pm-space-2\)\)/, '世界态势模块标题必须与其他三个模块使用同一字号');
assert.match(todayTrendStyle, /--pm-today-trend-world-hero-title-size:var\(--pm-font-size-subtitle\)/, '世界态势首条标题必须与后续条目使用同一字号');
assert.match(todayTrendStyle, /pm-today-trend-(?:reputation|factions|dynamics)>\.pm-today-trend-module-head h2[^}]*font-size:var\(--pm-today-trend-report-title-size\)/, '其他三个模块标题选择器必须消费统一字号 token');
assert.match(todayTrendStyle, /pm-today-trend-world>\.pm-today-trend-module-head h2[^}]*font-size:var\(--pm-today-trend-world-title-size\)/, '世界态势标题选择器必须消费统一字号 token');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-world \.pm-today-trend-module-head\.is-expanded,[^}]*\{[^}]*position:sticky[^}]*flex-direction:column/, '世界态势模块头必须固定在滚动内容顶部并以纵向结构容纳操作行');
assert.match(todayTrendStyle, /--pm-today-trend-world-brief-title-size:var\(--pm-font-size-subtitle\)/, '世界态势次级标题必须使用收紧后的字号');
assert.match(todayTrendStyle, /pm-today-trend-shell\{[^}]*--pm-today-trend-relation-node-size:var\(--pm-space-5\)/, '世界态势与关系节点必须共享 24px 可见圆尺寸 token');
assert.match(todayTrendStyle, /pm-today-trend-world-item-head\{[^}]*align-items:center[^}]*gap:var\(--pm-space-2\)/, '世界态势节点与标题必须垂直居中并使用统一间距');
assert.match(todayTrendStyle, /pm-today-trend-world-signal-marker\{[^}]*width:var\(--pm-today-trend-relation-node-size\)[^}]*height:var\(--pm-today-trend-relation-node-size\)[^}]*flex:0 0 var\(--pm-today-trend-relation-node-size\)/, '世界态势节点必须固定使用共享尺寸且不得被标题挤压');
assert.match(todayTrendStyle, /pm-today-trend-world-signal-marker::after\{display:none/, '世界态势节点不得保留原型以外的横向引线');
assert.match(todayTrendStyle, /pm-today-trend-world-hero b\{[^}]*font-size:var\(--pm-today-trend-world-hero-title-size\)[^}]*font-weight:var\(--pm-font-weight-semibold\)[^}]*line-height:var\(--pm-line-height-control\)/, '世界态势首条标题必须与后续条目使用相同文本节奏');
assert.match(todayTrendStyle, /pm-today-trend-world-brief b\{[^}]*font-size:var\(--pm-today-trend-world-brief-title-size\)[^}]*line-height:var\(--pm-line-height-control\)/, '世界态势后续标题必须消费统一字号 token 与行高');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-world-hero::before/, '世界态势不得恢复旧主摘要伪元素装饰');
assert.equal((worldPanelsHtml.match(/data-action="today-trend-toggle-menu"/g) || []).length, 1, '世界态势常态只允许模块头保留一个省略号入口');
assert.match(worldHtml, /today-trend-generate-world/, '世界态势页必须提供本模块生成动作');
assert.match(worldHtml, /aria-busy="false"/, '世界态势生成按钮必须提供非忙碌 ARIA 状态');
const busyWorldItemHtml = renderTodayTrendWorldView({ scope: valid.scopes.chat, generationAvailable: true, generationBusy: true, menuOpenId: 'world-module' });
const busyWorldHtml = renderTodayTrendWorldView({ scope: valid.scopes.chat, generationAvailable: true, generationBusy: true, menuOpenId: 'world-module' });
assert.match(busyWorldItemHtml, /today-trend-refresh-world-item"[^>]*disabled aria-busy="true"/, '忙碌时世界态势单项刷新必须禁用并暴露忙碌状态');
assert.match(busyWorldHtml, /today-trend-generate-world"[^>]*disabled aria-busy="true"/, '忙碌时世界态势模块生成必须禁用并暴露忙碌状态');
const busyWorldSettingsHtml = renderTodayTrendWorldView({ scope: valid.scopes.chat, mode: 'settings', generationAvailable: true, generationBusy: true });
assert.doesNotMatch(busyWorldSettingsHtml, /today-trend-regenerate-world-rule/, '世界态势设置不得重复提供模块规则动作');
assert.match(busyWorldHtml, /正在生成…/, '忙碌时世界态势必须展示生成状态');
const worldSettingsHtml = renderTodayTrendWorldView({ scope: valid.scopes.chat, mode: 'settings', editingWorldItemId: 'world', generationAvailable: true });
assert.match(worldSettingsHtml, /data-today-trend-form="world-item"/, '世界态势设置必须提供项目编辑表单');
const worldActionPair = worldSettingsHtml.match(/<div class="pm-today-trend-form-actions pm-action-pair">[\s\S]*?<\/div>/)?.[0] || '';
assert.ok(worldActionPair, '世界态势双操作区必须使用显式 pm-action-pair 契约');
assert.ok(worldActionPair.indexOf('today-trend-cancel-world-editor') < worldActionPair.indexOf('<button type="submit">保存</button>'),
    '世界态势编辑器必须按取消、保存的 DOM 与 Tab 顺序渲染');
assert.doesNotMatch(worldSettingsHtml, /today-trend-edit-world-rule/, '世界态势设置不得重复提供模块规则动作');
assert.doesNotMatch(worldSettingsHtml, /自然环境|行业环境|灵气环境/, '世界态势设置不得硬编码世界项目类别');
const reputationHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, preset: valid.presets.preset, mode: 'content', generationAvailable: true });
const reputationMenuHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, generationAvailable: true, menuOpenId: 'reputation-module' });
const reputationHeaderHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, generationAvailable: true, menuOpenId: 'reputation-module', floorStatus: '<span data-today-trend-floor="7"></span>' });
assert.match(reputationMenuHtml, /编辑个人风评提示词/, '个人风评入口必须使用中文提示词文案');
assert.doesNotMatch(reputationMenuHtml, /编辑个人风评 Prompt/, '个人风评入口不得残留英文 Prompt');
const reputationItemMenuHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, generationAvailable: true, menuOpenId: 'circle:judge' });
assert.match(reputationHtml, /pm-today-trend-module-head[\s\S]*?<\/header><div class="pm-today-trend-module-body">/, '个人风评必须将主题色模块头与灰色内容层拆为相邻容器');
assert.match(reputationHtml, /主厨评审/, '个人风评页必须渲染世界观圈层名称');
const reputationHeadHtml = reputationHeaderHtml.slice(reputationHeaderHtml.indexOf('<header class="pm-today-trend-module-head'), reputationHeaderHtml.indexOf('</header>') + '</header>'.length);
assert.ok(reputationHeadHtml.indexOf('<h2>个人风评</h2>') < reputationHeadHtml.indexOf('today-trend-generate-reputation')
    && reputationHeadHtml.indexOf('today-trend-generate-reputation') < reputationHeadHtml.indexOf('today-trend-edit-reputation-rule')
    && reputationHeadHtml.indexOf('today-trend-edit-reputation-rule') < reputationHeadHtml.indexOf('today-trend-toggle-menu'),
    '个人风评模块头必须先居中输出标题，再按刷新、提示词、条目操作的顺序输出三个图标按钮');
assert.match(reputationHeadHtml, /<h2>[\s\S]*?<\/h2>[\s\S]*?data-today-trend-floor/, '个人风评楼层状态必须位于标题右侧');
assert.match(reputationHtml, /中立/, '个人风评页必须渲染固定五档状态的中文标签');
assert.match(reputationHtml, /pm-today-trend-reputation-entry/, '个人风评内容页必须使用观察报告条目结构');
assert.match(reputationHtml, /pm-today-trend-meter-k">PEOPLE<\/span><span class="pm-today-trend-meter-v">1<\/span>/, '个人风评头部必须展示真实 PEOPLE 统计');
assert.match(reputationHtml, /pm-today-trend-meter-k">GOOD<\/span><span class="pm-today-trend-meter-v">0<\/span>/, '个人风评头部必须展示真实 GOOD 统计');
assert.match(reputationHtml, /pm-today-trend-meter-k">BAD<\/span><span class="pm-today-trend-meter-v">0<\/span>/, '个人风评头部必须展示真实 BAD 统计');
assert.doesNotMatch(reputationHtml, /pm-today-trend-reputation-(?:head-art|file-no)|PRS-240502/, '个人风评不得渲染已废弃的档案装饰或编号');
assert.match(reputationHtml, /pm-today-trend-reputation-mark/, '个人风评条目必须提供图标标记');
assert.match(reputationHtml, /data-status="neutral"/, '个人风评状态必须提供主题化样式钩子');
assert.doesNotMatch(reputationHtml, /pm-today-trend-reputation-entry-head[\s\S]*?pm-today-trend-status/, '个人风评条目标题栏不得渲染状态徽章');
assert.match(reputationHtml, /pm-today-trend-reputation-entry-head[\s\S]*?pm-today-trend-reputation-mark[\s\S]*?<b>主厨评审/, '个人风评条目标题栏必须让标题直接位于图标右侧');
const reputationEntryHeadHtml = reputationHtml.match(/<header class="pm-today-trend-reputation-entry-head">[\s\S]*?<\/header>/)?.[0] || '';
assert.ok(reputationEntryHeadHtml, '个人风评非编辑条目必须渲染标题栏');
assert.doesNotMatch(reputationEntryHeadHtml, /pm-today-trend-inline-actions/, '个人风评标题栏不得包含行内操作');
const reputationEntryHtml = reputationHtml.match(/<article class="pm-today-trend-reputation-entry"[^>]*data-circle-id="judge"[\s\S]*?<\/article>/)?.[0] || '';
assert.ok(reputationEntryHtml, '个人风评样本必须渲染独立条目片段');
const reputationEntryBodyHtml = reputationEntryHtml.match(/<div class="pm-today-trend-reputation-entry-body">[\s\S]*?<\/div><\/article>/)?.[0] || '';
assert.ok(reputationEntryBodyHtml, '个人风评 judge 条目必须渲染独立正文片段');
assert.match(reputationEntryHtml, /pm-today-trend-reputation-entry-body[\s\S]*?<p>[\s\S]*?<\/p>[\s\S]*?pm-today-trend-reputation-rating/, '个人风评 judge 条目正文必须按正文段落、评级控件顺序渲染');
assert.doesNotMatch(reputationHtml, /pm-today-trend-reputation-orbit/, '个人风评背景不得局限在模块子容器内');
assert.match(reputationMenuHtml, /today-trend-edit-reputation-rule/, '展开个人风评模块操作后必须提供规则编辑动作');
assert.doesNotMatch(reputationHtml, /today-trend-edit-circle/, '个人风评收起模块操作时不得显示单条编辑入口');
assert.match(reputationHtml, /pm-today-trend-reputation-meter" role="radiogroup" aria-label="修改主厨评审的好感度，当前：中立"/, '个人风评必须为每条记录输出可访问的好感度单选组');
assert.equal((reputationHtml.match(/data-action="today-trend-set-circle-status"/g) || []).length, valid.scopes.chat.reputation.circles.length * 5, '个人风评每条记录必须输出五个实时状态按钮');
assert.match(reputationHtml, /data-circle-id="judge" data-status="neutral" aria-checked="true" role="radio"/, '当前好感度按钮必须暴露选中语义');
assert.match(reputationHtml, /data-circle-id="judge" data-status="like" aria-checked="false" role="radio"/, '非当前好感度按钮必须暴露未选中语义');
assert.deepEqual([...reputationHtml.matchAll(/data-circle-id="judge" data-status="([^"]+)"/g)].map(match => match[1]), TODAY_TREND_RELATION_STATUSES, '个人风评量表必须从左到右按敌对至信任的模型顺序排列');
for (const label of ['敌对', '厌恶', '中立', '喜爱', '信任']) assert.match(reputationHtml, new RegExp(`aria-label="${label}"`), `个人风评必须以可访问名称提供五档好感度：${label}`);
const minimalReputationScope = structuredClone(valid.scopes.chat);
minimalReputationScope.injection.minimalUi = true;
const minimalReputationHtml = renderTodayTrendReputationView({ scope: minimalReputationScope });
const busyMinimalReputationHtml = renderTodayTrendReputationView({ scope: minimalReputationScope, generationBusy: true });
assert.match(minimalReputationHtml, /data-action="today-trend-cycle-circle-status" data-circle-id="judge"/, '极简 UI 的个人风评图标必须提供循环切换动作');
assert.match(minimalReputationHtml, /data-action="today-trend-cycle-circle-status" data-circle-id="judge" data-status="neutral"/, '极简 UI 的个人风评图标必须暴露当前关系状态钩子');
assert.match(minimalReputationHtml, /aria-label="切换主厨评审的关系状态，当前：中立"/, '极简 UI 的个人风评图标必须暴露当前关系状态');
assert.match(minimalReputationHtml, /pm-today-trend-relation-symbol" aria-hidden="true"><svg/, '极简 UI 的个人风评关系按钮必须使用独立的装饰性实心圆容器');
assert.match(minimalReputationHtml, new RegExp(TODAY_TREND_RELATION_ICON_PATHS.neutral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '个人风评极简图标必须复用既有中立关系 SVG');
assert.doesNotMatch(minimalReputationHtml, /today-trend-cycle-circle-status"[^>]* disabled/, '空闲时个人风评极简图标必须可用');
assert.match(busyMinimalReputationHtml, /today-trend-cycle-circle-status"[^>]* disabled/, '生成忙碌时个人风评极简图标必须禁用');
assert.doesNotMatch(reputationHtml, /today-trend-refresh-circle/, '个人风评内容区不得保留单项重新生成入口');
const mixedReputationScope = structuredClone(valid.scopes.chat);
mixedReputationScope.reputation.circles = [
    { id: 'trust', name: '信任样本', status: 'trust', evaluation: '可靠' },
    { id: 'like', name: '喜爱样本', status: 'like', evaluation: '积极' },
    { id: 'neutral', name: '中立样本', status: 'neutral', evaluation: '观察' },
    { id: 'dislike', name: '厌恶样本', status: 'dislike', evaluation: '谨慎' },
    { id: 'hostile', name: '敌对样本', status: 'hostile', evaluation: '冲突' },
];
const mixedReputationHtml = renderTodayTrendReputationView({ scope: mixedReputationScope });
assert.match(mixedReputationHtml, /pm-today-trend-meter-k">PEOPLE<\/span><span class="pm-today-trend-meter-v">5<\/span>/, '个人风评 PEOPLE 必须覆盖混合圈层样本');
assert.match(mixedReputationHtml, /pm-today-trend-meter-k">GOOD<\/span><span class="pm-today-trend-meter-v">2<\/span>/, '个人风评 GOOD 必须只统计 like/trust');
assert.match(mixedReputationHtml, /pm-today-trend-meter-k">BAD<\/span><span class="pm-today-trend-meter-v">2<\/span>/, '个人风评 BAD 必须只统计 hostile/dislike');
assert.match(reputationMenuHtml, /today-trend-edit-circle[^>]*data-circle-id="judge"/, '展开个人风评模块操作后必须显示条目编辑动作');
assert.match(reputationMenuHtml, /today-trend-regenerate-circle-schema[^>]*data-circle-id="judge"/, '展开个人风评模块操作后必须显示条目结构重新生成动作');
assert.match(reputationMenuHtml, /today-trend-delete-circle[^>]*data-circle-id="judge"/, '展开个人风评模块操作后必须显示条目删除动作');
assert.match(reputationMenuHtml, /data-circle-id="judge"[\s\S]*?pm-today-trend-inline-actions[\s\S]*?today-trend-regenerate-circle-schema[\s\S]*?today-trend-edit-circle[\s\S]*?today-trend-delete-circle/, '个人风评行内操作必须按重新生成、编辑、删除排序');
assert.equal((reputationMenuHtml.match(/pm-today-trend-inline-action[^s]/g) || []).length, valid.scopes.chat.reputation.circles.length * 3, '个人风评每条记录必须输出三个行内操作按钮');
assert.match(reputationMenuHtml, /today-trend-generate-reputation[\s\S]*?today-trend-edit-reputation-rule/, '个人风评刷新与提示词操作必须直接显示在模块头');
assert.match(reputationMenuHtml, /today-trend-toggle-menu"[^>]*data-menu-id="reputation-module"[^>]*aria-expanded="true"/, '个人风评条目操作展开态必须由模块头省略号明确暴露');
assert.doesNotMatch(reputationItemMenuHtml, /today-trend-edit-circle/, '旧圈层菜单 ID 不得意外展开行内动作');
const reputationEditorHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, editingCircleId: 'judge' });
assert.match(reputationEditorHtml, /pm-today-trend-reputation-entry is-editing[\s\S]*?data-today-trend-form="circle"/, '个人风评内容区的编辑铅笔必须打开该条目的内联编辑表单');
assert.match(reputationEditorHtml, /data-action="today-trend-cancel-reputation-editor"/, '个人风评内联编辑取消必须停留在内容页');
const reputationActionPair = reputationEditorHtml.match(/<div class="pm-today-trend-form-actions pm-action-pair">[\s\S]*?<\/div>/)?.[0] || '';
assert.ok(reputationActionPair, '个人风评双操作区必须使用显式 pm-action-pair 契约');
assert.ok(reputationActionPair.indexOf('today-trend-cancel-reputation-editor') < reputationActionPair.indexOf('<button type="submit">保存</button>'),
    '个人风评编辑器必须按取消、保存的 DOM 与 Tab 顺序渲染');
const reputationSettingsHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, mode: 'settings' });
assert.doesNotMatch(reputationSettingsHtml, /name="status"/, '个人风评设置不得暴露状态修改入口');
const busyReputationHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, generationAvailable: true, generationBusy: true, menuOpenId: 'reputation-module' });
assert.match(busyReputationHtml, /today-trend-generate-reputation"[^>]*disabled aria-busy="true"/, '忙碌时个人风评模块生成必须禁用并暴露忙碌状态');
assert.match(busyReputationHtml, /today-trend-set-circle-status"[^>]*disabled/, '生成忙碌时个人风评状态按钮必须禁用');
const busyReputationSettingsHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, mode: 'settings', generationAvailable: true, generationBusy: true, menuOpenId: 'reputation-settings' });
assert.match(busyReputationSettingsHtml, /today-trend-regenerate-circle-schema"[^>]*disabled aria-busy="true"/, '忙碌时圈层结构重新生成必须禁用并暴露忙碌状态');
assert.doesNotMatch(busyReputationSettingsHtml, /data-menu-id="circle:/, '风评设置不得重复渲染圈层省略号');
assert.doesNotMatch(busyReputationSettingsHtml, /today-trend-regenerate-reputation-rule/, '个人风评设置不得重复提供模块规则动作');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:reputation|factions|dynamics)::(?:before|after)[^{]*\{[^}]*mask-image/, '个人风评、势力和事件不得恢复头尾 SVG 背景');
assert.match(todayTrendStyle, /pm-today-trend-reputation-mark\{[^}]*width:var\(--pm-today-trend-relation-node-size\)[^}]*height:var\(--pm-today-trend-relation-node-size\)/, '个人风评普通模式图标必须与世界态势节点共享可见尺寸');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-reputation-(?:head-art|file-no)/, '个人风评不得保留没有 DOM 消费者的档案装饰样式');
assert.match(todayTrendStyle, /pm-today-trend-reputation-mark\{[^}]*border:0[^}]*border-radius:var\(--pm-radius-circle\)[^}]*background:var\(--pm-color-accent\)/, '个人风评图标必须统一为圆形主题节点');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry-head>b\{[^}]*font-size:var\(--pm-font-size-subtitle\)[^}]*line-height:var\(--pm-line-height-control\)/, '个人风评条目标题必须与世界态势使用相同字号和行高');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-reputation-mark::(?:before|after)/, '个人风评图标不得恢复装饰伪元素');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry\{[^}]*display:flex[^}]*flex-direction:column/, '个人风评条目必须使用标题栏与内容栏上下布局');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry-head\{[^}]*display:flex[^}]*align-items:center[^}]*gap:var\(--pm-space-2\)/, '个人风评标题栏必须让图标与标题居中对齐');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry-body\{[^}]*min-width:0[^}]*\}/, '个人风评内容栏必须完整占据标题栏下方而非伪装成右侧栏');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-reputation-entry-body\{[^}]*margin-left/, '个人风评内容栏不得保留图标宽度形成的左侧空栏');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button\{[^}]*min-height:var\(--pm-size-control-default\)/, '个人风评五档状态按钮必须保留 44px 主触控高度');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter\{[^}]*display:flex[^}]*justify-content:center[^}]*gap:var\(--pm-space-1\)[^}]*border:0[^}]*background:transparent/, '个人风评量表必须使用居中的轻量图标组选项');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button\{[^}]*min-width:var\(--pm-size-control-default\)[^}]*flex:0 1 var\(--pm-size-control-default\)[^}]*align-items:center[^}]*justify-content:center/, '个人风评五档按钮必须使用紧凑且居中的固定触控单元');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button svg\{[^}]*width:var\(--pm-size-icon-sm\)[^}]*height:var\(--pm-size-icon-sm\)/, '个人风评五档必须使用可辨识的状态图标');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button span\{[^}]*font-size:var\(--pm-font-size-micro\)/, '个人风评量表档位标签必须使用紧凑字号');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button\.is-active\{[^}]*border-bottom-color:var\(--pm-color-accent\)[^}]*color:var\(--pm-color-accent\)/, '个人风评量表当前档必须以主题色图标和底部线明确标识');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-reputation-meter button::before|pm-today-trend-reputation-meter button::after/, '个人风评量表不得使用圆点或底线伪元素');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button:focus-visible/, '个人风评状态按钮必须提供键盘焦点样式');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button:disabled/, '个人风评状态按钮必须提供禁用样式');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry\.is-editing\{[^}]*display:block/, '个人风评编辑态必须退出内容分区布局，供编辑器完整展开');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry\.is-editing>\.pm-today-trend-editor\{[^}]*width:100%/, '个人风评编辑器必须占满编辑态行宽');
assert.doesNotMatch(reputationHtml, /pm-today-trend-reputation-foot-art/, '个人风评内容页不得渲染底部装饰 SVG');
const factionHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, menuOpenId: 'faction-module' });
const factionItemMenuHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, menuOpenId: 'faction:red' });
const factionHeaderHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, menuOpenId: 'faction-module', floorStatus: '<span data-today-trend-floor="7"></span>' });
assert.match(factionHtml, /编辑势力图谱提示词/, '势力图谱入口必须使用中文提示词文案');
assert.doesNotMatch(factionHtml, /编辑势力图谱 Prompt/, '势力图谱入口不得残留英文 Prompt');
assert.match(factionHtml, /pm-today-trend-module-head[\s\S]*?<\/header><div class="pm-today-trend-module-body">/, '势力图谱必须将主题色模块头与灰色内容层拆为相邻容器');
assert.match(factionHtml, /红队/, '势力页必须渲染根势力');
assert.match(factionHtml, /节目组/, '势力页必须递归渲染子势力');
const factionHeadHtml = factionHeaderHtml.slice(factionHeaderHtml.indexOf('<header class="pm-today-trend-module-head'), factionHeaderHtml.indexOf('</header>') + '</header>'.length);
assert.ok(factionHeadHtml.indexOf('<h2>势力图谱</h2>') < factionHeadHtml.indexOf('today-trend-generate-factions')
    && factionHeadHtml.indexOf('today-trend-generate-factions') < factionHeadHtml.indexOf('today-trend-edit-faction-rule')
    && factionHeadHtml.indexOf('today-trend-edit-faction-rule') < factionHeadHtml.indexOf('today-trend-toggle-menu'),
    '势力图谱模块头必须先居中输出标题，再按刷新、提示词、条目操作的顺序输出三个图标按钮');
assert.match(factionHeadHtml, /<h2>[\s\S]*?<\/h2>[\s\S]*?data-today-trend-floor/, '势力图谱楼层状态必须位于标题右侧');
assert.match(factionHtml, /队长/, '势力卡片必须直接展示关键资料');
assert.match(factionHtml, /pm-today-trend-faction-tree" data-depth="0"/, '势力图谱必须标识根层级');
assert.match(factionHtml, /pm-today-trend-faction-card"[^>]*data-depth="1"/, '势力图谱必须标识子层级');
assert.match(todayTrendStyle, /pm-today-trend-faction-tree\[data-depth\]:not\(\[data-depth="0"\]\)\{[^}]*border-top:1px solid/, '势力子层级内嵌时必须用分隔线区分层级');
assert.match(todayTrendStyle, /pm-today-trend-faction-card .pm-today-trend-faction-card\{[^}]*background:var\(--pm-color-surface-elevated\)/, '内嵌子势力卡片必须使用更浅背景');
assert.match(todayTrendStyle, /pm-today-trend-faction-entry-head \.pm-today-trend-relation-slot>\.pm-today-trend-faction-node\{[^}]*width:var\(--pm-today-trend-relation-node-size\)[^}]*height:var\(--pm-today-trend-relation-node-size\)/, '势力图谱普通模式节点必须与世界态势节点共享可见尺寸');
assert.match(todayTrendStyle, /pm-today-trend-faction-entry-head>b\{[^}]*flex:1[^}]*overflow-wrap:anywhere[^}]*font-size:var\(--pm-font-size-subtitle\)[^}]*line-height:var\(--pm-line-height-control\)/, '势力图谱标题行必须为图标、标题和操作保留稳定布局并允许长标题断行');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-faction-detail\{[^}]*border-left|pm-today-trend-faction-detail-row::before/, '势力详情不得恢复轨道线或菱形连接器');
assert.match(factionHtml, /pm-today-trend-faction-entry-head[\s\S]*?pm-today-trend-faction-node[\s\S]*?<b>红队<\/b>/, '势力图谱节点必须直接归入条目标题行');
assert.match(factionHtml, /pm-today-trend-faction-entry-body[\s\S]*?pm-today-trend-faction-summary/, '势力图谱正文必须位于标题行之后');
const redFactionCardHtml = factionHtml.match(/<article class="pm-today-trend-faction-card"[^>]*data-faction-id="red"[\s\S]*?<\/article>/)?.[0] || '';
assert.ok(redFactionCardHtml, '势力图谱红队必须渲染独立卡片片段');
const factionEntryHeadHtml = redFactionCardHtml.match(/<header class="pm-today-trend-faction-entry-head">[\s\S]*?<\/header>/)?.[0] || '';
assert.ok(factionEntryHeadHtml, '势力图谱非编辑条目必须渲染标题栏');
assert.doesNotMatch(factionEntryHeadHtml, /pm-today-trend-inline-actions/, '势力图谱条目标题栏不得包含行内操作');
assert.match(redFactionCardHtml, /pm-today-trend-faction-summary[\s\S]*?pm-today-trend-inline-actions[\s\S]*?pm-today-trend-faction-detail[\s\S]*?pm-today-trend-faction-rating/, '操作必须位于摘要下方且详情与评级控件之前');
assert.match(factionHtml, /pm-today-trend-faction-detail-row is-evaluation"><dt>关系评价<\/dt><dd>/, '势力关系评价必须保持完整的定义列表语义');
assert.match(todayTrendStyle, /pm-today-trend-faction-detail-row\{[^}]*display:grid[^}]*grid-template-columns:var\(--pm-size-control-default\) minmax\(0,1fr\)/, '势力详情行必须使用标签列与弹性值列布局');
assert.match(todayTrendStyle, /pm-today-trend-faction-detail-row\.is-evaluation\{[^}]*display:flex[^}]*flex-wrap:wrap[^}]*column-gap:var\(--pm-space-2\)/, '关系评价必须允许内容按可用宽度整项换行');
assert.match(todayTrendStyle, /pm-today-trend-faction-detail-row\.is-evaluation dd\{[^}]*width:max-content[^}]*max-width:100%[^}]*flex:0 0 auto/, '关系评价短内容必须保持同行，长内容必须换到完整内容行');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-faction-detail-row\.is-evaluation\{[^}]*display:block/, '关系评价不得强制所有内容换行');
assert.match(todayTrendStyle, /pm-today-trend-faction-meter\{[^}]*display:flex[^}]*width:100%[^}]*justify-content:center/, '势力关系量表必须使用横向居中布局');
assert.match(todayTrendStyle, /pm-today-trend-faction-meter>span\{[^}]*min-height:var\(--pm-size-control-default\)[^}]*flex-direction:column[^}]*padding:var\(--pm-space-0-5\)/, '势力关系档位必须与个人风评保持一致的纵向图标文字结构');
const minimalFactionScope = structuredClone(valid.scopes.chat);
minimalFactionScope.injection.minimalUi = true;
const minimalFactionHtml = renderTodayTrendFactionView({ scope: minimalFactionScope });
const busyMinimalFactionHtml = renderTodayTrendFactionView({ scope: minimalFactionScope, generationBusy: true });
assert.match(minimalFactionHtml, /data-action="today-trend-cycle-faction-status" data-faction-id="red"/, '极简 UI 的势力关系图标必须提供循环切换动作');
assert.match(minimalFactionHtml, /data-action="today-trend-cycle-faction-status" data-faction-id="red" data-status="like"/, '极简 UI 的势力关系图标必须暴露当前关系状态钩子');
assert.match(minimalFactionHtml, /aria-label="切换红队的关系状态，当前：喜欢"/, '极简 UI 的势力关系图标必须暴露当前关系状态');
assert.match(minimalFactionHtml, /pm-today-trend-relation-symbol" aria-hidden="true"><svg/, '极简 UI 的势力关系按钮必须使用独立的装饰性实心圆容器');
assert.match(minimalFactionHtml, new RegExp(TODAY_TREND_RELATION_ICON_PATHS.like.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '势力极简图标必须复用既有喜欢关系 SVG');
assert.doesNotMatch(minimalFactionHtml, /today-trend-cycle-faction-status"[^>]* disabled/, '空闲时势力极简图标必须可用');
assert.match(busyMinimalFactionHtml, /today-trend-cycle-faction-status"[^>]* disabled/, '生成忙碌时势力极简图标必须禁用');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-reputation-rating,\.pm-today-trend-content\.is-minimal-ui \.pm-today-trend-faction-rating\{display:none/, '极简 UI 必须仅在隔离容器内隐藏两类关系量表且不留空位');
assert.doesNotMatch(todayTrendStyle, /(?:^|\})\.pm-today-trend-(?:reputation|faction)-(?:rating|meter)\{display:none/, '普通模式不得隐藏关系量表');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-reputation-mark,\.pm-today-trend-content\.is-minimal-ui \.pm-today-trend-faction-node\{[^}]*min-width:var\(--pm-size-control-default\)[^}]*min-height:var\(--pm-size-control-default\)[^}]*background:transparent/, '极简关系按钮必须提供透明的 44px 命中区');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-relation-symbol\{[^}]*width:var\(--pm-today-trend-relation-node-size\)[^}]*height:var\(--pm-today-trend-relation-node-size\)[^}]*border-radius:var\(--pm-radius-circle\)/, '极简关系可见圆必须独立使用共享 24px 尺寸');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-(?:reputation-mark|faction-node)[^{]*\{[^}]*background-clip/, '极简关系节点不得再以背景裁剪伪造可见圆');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-(?:reputation-mark|faction-node)[^{]*\{[^}]*margin:calc/, '极简关系节点不得再以负 margin 补偿尺寸');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-module-head:not\(\.is-expanded\)\{[^}]*align-items:center[^}]*min-height:calc\(var\(--pm-size-control-default\) \+ var\(--pm-space-2\)\)[^}]*padding-bottom:var\(--pm-space-3\)/, '极简 UI 的非固定模块头必须保持原有居中节奏');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-floor\{[^}]*gap:var\(--pm-space-0-5\)/, '极简 UI 楼层五态必须使用稳定的紧凑间距');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-world-hero p,\.pm-today-trend-content\.is-minimal-ui \.pm-today-trend-world-brief p\{[^}]*margin:var\(--pm-space-0\)[^}]*line-height:var\(--pm-line-height-loose\)/, '极简 UI 世界态势标题与说明必须使用网格节奏和舒展行高');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-reputation-entry,\.pm-today-trend-content\.is-minimal-ui \.pm-today-trend-faction-card,\.pm-today-trend-content\.is-minimal-ui \.pm-today-trend-event-body\{[^}]*row-gap:var\(--pm-space-2\)/, '极简 UI 四类内容必须使用收紧标题—说明节奏');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-reputation-entry-body>p,[^}]*pm-today-trend-faction-detail-row dd,[^}]*pm-today-trend-event-latest span\{[^}]*line-height:var\(--pm-line-height-loose\)/, '极简 UI 多行说明与详情值必须使用舒展行高');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-faction-detail-row dt\{color:var\(--pm-color-accent\)/, '极简 UI 势力详情短标签必须跟随主题色');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-minimal-ui \.pm-today-trend-event-facts\{[^}]*margin-block-start:var\(--pm-space-0\)/, '极简 UI 事件事实区不得继承普通模式的负偏移');
for (const [status, colors] of Object.entries({
    hostile: ['--pm-today-trend-relation-hostile', '--pm-today-trend-relation-hostile-foreground'],
    dislike: ['--pm-today-trend-relation-dislike', '--pm-today-trend-relation-dislike-foreground'],
    neutral: ['--pm-today-trend-relation-neutral', '--pm-today-trend-relation-neutral-foreground'],
    like: ['--pm-today-trend-relation-like', '--pm-today-trend-relation-like-foreground'],
    trust: ['--pm-today-trend-relation-trust', '--pm-today-trend-relation-trust-foreground'],
})) {
    const [background, color] = colors;
    assert.match(todayTrendStyle, new RegExp(`pm-today-trend-content\\.is-minimal-ui :is\\(\\.pm-today-trend-reputation-mark,\\.pm-today-trend-faction-node\\)\\[data-status="${status}"\\] \\.pm-today-trend-relation-symbol\\{[^}]*background:var\\(${background}\\)[^}]*color:var\\(${color}\\)`), `极简 UI ${status} 状态必须以实心语义圆和高对比 SVG 前景表达`);
}
assert.doesNotMatch(todayTrendStyle, /(?:^|\})\.pm-today-trend-event-facts\{[^}]*margin-block-start:var\(--pm-space-0\)/, '普通模式事件事实区不得被极简 UI 的零偏移规则污染');
assert.doesNotMatch(todayTrendStyle, /(?:^|\})\.pm-today-trend-reputation-mark\[data-status="(?:hostile|dislike|neutral|like|trust)"\]/, '普通模式不得新增关系状态颜色覆盖');
assert.match(todayTrendStyle, /@media\(max-width:320px\)[\s\S]*?pm-today-trend-reputation-meter,\.pm-today-trend-faction-meter\{[^}]*column-gap:var\(--pm-space-0-5\)/, '320px 下两种关系量表必须同步收紧间距');
assert.doesNotMatch(todayTrendStyle, /@media\(max-width:320px\)[\s\S]*?pm-today-trend-faction-entry-head\{flex-wrap:wrap\}/, '320px 下不得恢复已移出标题行的势力操作区换行规则');
assert.doesNotMatch(todayTrendStyle, /@media\(max-width:320px\)[\s\S]*?pm-today-trend-faction-entry-head>\.pm-today-trend-inline-actions\{margin-left:var\(--pm-space-auto\)\}/, '320px 下不得保留已移出标题行的势力操作区旧规则');

assert.doesNotMatch(factionHtml, /pm-today-trend-external-list|pm-today-trend-external-relation/, '外部关联不得再单独列成第二份势力清单');
assert.match(factionHtml, /pm-today-trend-faction-node/, '势力图谱必须输出独立节点装饰');
assert.doesNotMatch(factionHtml, /pm-today-trend-faction-constellation/, '势力背景不得局限在模块子容器内');
assert.match(factionHtml, /today-trend-edit-faction-rule/, '势力图谱模块必须提供规则编辑动作');
assert.doesNotMatch(factionHtml, /today-trend-add-faction/, '势力图谱顶级操作不得保留计划外添加势力入口');
assert.match(factionHtml, /today-trend-edit-faction[^>]*data-faction-id="red"/, '展开势力图谱模块操作后必须显示条目编辑入口');
assert.match(factionHtml, /today-trend-refresh-faction[^>]*data-faction-id="red"/, '展开势力图谱模块操作后必须显示条目重新生成入口');
assert.match(factionHtml, /today-trend-delete-faction[^>]*data-faction-id="red"/, '展开势力图谱模块操作后必须显示条目删除入口');
assert.match(factionHtml, /data-faction-id="red"[\s\S]*?pm-today-trend-inline-actions[\s\S]*?today-trend-refresh-faction[\s\S]*?today-trend-edit-faction[\s\S]*?today-trend-delete-faction/, '势力图谱行内操作必须按重新生成、编辑、删除排序');
assert.match(factionHtml, /today-trend-generate-factions[\s\S]*?today-trend-edit-faction-rule/, '势力图谱刷新与提示词操作必须直接显示在模块头');
assert.match(factionHtml, /today-trend-toggle-menu"[^>]*data-menu-id="faction-module"[^>]*aria-expanded="true"/, '势力图谱条目操作展开态必须由模块头省略号明确暴露');
assert.doesNotMatch(factionItemMenuHtml, /pm-today-trend-inline-actions/, '旧势力条目菜单 ID 不得意外展开任何行内动作');
const deepFactionScope = structuredClone(valid.scopes.chat);
deepFactionScope.factions = Array.from({ length: 12 }, (_, index) => ({ id: `deep-${index}`, name: `深层势力${index}`, summary: '链式层级', parentId: index ? `deep-${index - 1}` : null, relatedFactionIds: [], details: [], relation: { status: 'neutral', evaluation: '观察中' } }));
assert.match(renderTodayTrendFactionView({ scope: deepFactionScope }), /data-depth="11"/, '合法深层势力链必须保持可渲染，而非截断数据');
const malformedRelationScope = structuredClone(valid.scopes.chat);
malformedRelationScope.factions[0].relation = [];
assert.match(renderTodayTrendFactionView({ scope: malformedRelationScope }), /data-faction-id="red"[\s\S]*?data-status="neutral"/, '势力视图必须将数组 relation 回退为中立对象');
const busyFactionHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, generationAvailable: true, generationBusy: true, menuOpenId: 'faction-module' });
assert.match(busyFactionHtml, /today-trend-generate-factions"[^>]*disabled aria-busy="true"/, '忙碌时势力模块生成必须禁用并暴露忙碌状态');
assert.match(busyFactionHtml, /today-trend-refresh-faction"[^>]*disabled aria-busy="true"/, '忙碌时势力条目重新生成必须禁用并暴露忙碌状态');
assert.match(renderTodayTrendReputationView({ scope: valid.scopes.chat, mode: 'settings', menuOpenId: 'reputation-settings' }), /today-trend-regenerate-circle-schema/, '个人风评设置顶级操作打开后必须提供结构重新生成动作');
const factionEditorHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, mode: 'editor', editingFactionId: 'red' });
assert.match(factionEditorHtml, /<div class="pm-today-trend-module-body">[\s\S]*data-today-trend-form="faction"/, '势力编辑页必须复用带横向留白和底部安全区的内容层');
assert.match(factionEditorHtml, /name="parentId"/, '势力编辑页必须提供可空父势力选择');
const factionActionPair = factionEditorHtml.match(/<div class="pm-today-trend-form-actions pm-action-pair">[\s\S]*?<\/div>/)?.[0] || '';
assert.ok(factionActionPair, '势力编辑双操作区必须使用显式 pm-action-pair 契约');
assert.ok(factionActionPair.indexOf('today-trend-cancel-editor') < factionActionPair.indexOf('<button type="submit">保存</button>'),
    '势力编辑器必须按取消、保存的 DOM 与 Tab 顺序渲染');
const busyFactionSettingsHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, mode: 'settings', generationAvailable: true, generationBusy: true });
assert.doesNotMatch(busyFactionSettingsHtml, /today-trend-regenerate-faction-rule/, '势力图谱设置不得重复提供模块规则动作');
const busyDynamicsHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, generationBusy: true, menuOpenId: 'dynamics-module' });
const dynamicsItemMenuHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, menuOpenId: 'event:service' });
assert.match(busyDynamicsHtml, /today-trend-advance-all-events[\s\S]*?disabled aria-busy="true"/, '忙碌时动态模块生成必须禁用并暴露忙碌状态');
assert.match(busyDynamicsHtml, /today-trend-edit-dynamics-rule/, '动态模块必须提供规则编辑动作');
assert.doesNotMatch(busyDynamicsHtml, /pm-today-trend-dynamics-(?:head|foot)-art/, '事件追踪不得渲染头尾装饰 SVG');
assert.match(busyDynamicsHtml, /today-trend-open-dynamics-settings/, '动态模块必须保留专属设置动作');
assert.doesNotMatch(busyDynamicsHtml, /today-trend-create-event/, '动态模块顶级操作不得保留计划外创建事件入口');
const activeEventCardHtml = busyDynamicsHtml.match(/<article class="pm-today-trend-event-card"[^>]*data-event-id="service"[\s\S]*?<\/article>/)?.[0] || '';
assert.ok(activeEventCardHtml, '进行中事件必须渲染独立事件卡片');
const activeEventHeaderHtml = activeEventCardHtml.match(/<header>[\s\S]*?<\/header>/)?.[0] || '';
assert.ok(activeEventHeaderHtml, '进行中事件卡片必须渲染独立标题栏片段');
assert.doesNotMatch(activeEventHeaderHtml, /pm-today-trend-inline-actions/, '进行中事件标题栏不得包含行内操作');
assert.match(activeEventCardHtml, /today-trend-advance-event[\s\S]*?today-trend-edit-event[\s\S]*?today-trend-archive-event/, '进行中事件的标准行内操作必须按重新生成、编辑、归档排序');
assert.equal((activeEventCardHtml.match(/pm-today-trend-inline-action(?:\s|")/g) || []).length, 3, '普通进行中事件必须恰好输出三个标准行内操作');
assert.doesNotMatch(activeEventCardHtml, /today-trend-promote-underground|today-trend-delete-event/, '普通进行中事件不得泄漏地下线升级或归档删除动作');
assert.match(busyDynamicsHtml, /today-trend-advance-event"[^>]*disabled aria-busy="true"/, '忙碌时单条事件重新生成必须禁用并暴露忙碌状态');
assert.match(busyDynamicsHtml, /today-trend-advance-all-events[\s\S]*?today-trend-edit-dynamics-rule/, '事件追踪刷新与提示词操作必须直接显示在模块头');
assert.match(busyDynamicsHtml, /pm-today-trend-menu-wrap is-open[\s\S]*?today-trend-open-dynamics-settings/, '事件追踪第三个模块动作必须在模块头省略号展开后显示');
assert.doesNotMatch(dynamicsItemMenuHtml, /pm-today-trend-inline-actions/, '旧事件条目菜单 ID 不得意外展开任何行内动作');
assert.match(busyDynamicsHtml, /pm-today-trend-event-facts/, '动态内容页必须提供结构化事件事实区');
assert.match(busyDynamicsHtml, /pm-today-trend-event-history/, '动态内容页必须提供阶段时间线容器');
assert.match(busyDynamicsHtml, /pm-today-trend-event-marker" data-today-trend-icon="[^"]+" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span>/, '事件追踪卡片必须包含带 key 的 SVG 左侧节点');
assert.match(busyDynamicsHtml, /pm-today-trend-event-body/, '事件追踪卡片必须将内容与左侧节点分层');
assert.match(busyDynamicsHtml, /pm-today-trend-dynamics-switch[^>]*data-action="today-trend-set-dynamics-tab"[^>]*data-tab="archived"/, '事件追踪必须提供标题旁的切换按钮');
assert.match(busyDynamicsHtml, /pm-today-trend-active-panel[\s\S]*?pm-today-trend-archived-panel[^>]*hidden/, '事件追踪必须同时渲染活跃与归档面板，非活跃面板 hidden');
assert.match(busyDynamicsHtml, /pm-today-trend-event-pill is-live/, '活跃事件必须提供带状态点的 pill');
assert.match(busyDynamicsHtml, /pm-today-trend-stage-tag">最新阶段/, '活跃事件的最后阶段必须标记为最新阶段');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-event-list::before/, '事件追踪列表必须删除左侧大轨道');
assert.match(todayTrendStyle, /pm-today-trend-dynamics\{[^}]*--pm-today-trend-dynamics-icon-size:var\(--pm-space-5\)/, '事件追踪节点尺寸必须与世界态势节点一致');
assert.match(todayTrendStyle, /pm-today-trend-dynamics>\.pm-today-trend-module-head\{[^}]*padding-bottom:var\(--pm-space-2\)/, '事件追踪分页必须靠近模块标题');
assert.match(todayTrendStyle, /pm-today-trend-event-marker\{[^}]*background:var\(--pm-color-accent\)[^}]*color:var\(--pm-color-on-accent\)/, '事件追踪大图标必须使用主题色');
assert.match(todayTrendStyle, /pm-today-trend-event-heading>b\{[^}]*font-size:var\(--pm-font-size-subtitle\)[^}]*line-height:var\(--pm-line-height-control\)/, '事件追踪条目标题必须与世界态势使用相同字号和行高');
assert.match(todayTrendStyle, /pm-today-trend-event-body>header\{[^}]*display:flex[^}]*justify-content:space-between/, '事件追踪标题栏必须使用独立弹性布局');
assert.match(todayTrendStyle, /pm-today-trend-event-body>\.pm-today-trend-inline-actions\{[^}]*align-self:center[^}]*margin-top:var\(--pm-space-1\)/, '事件追踪标题栏下方行内操作必须居中并使用既有顶部间距 token');
assert.match(todayTrendStyle, /pm-today-trend-event-card\{[^}]*display:flex[^}]*flex-direction:column/, '事件追踪卡片必须使用弹性纵向布局');
assert.match(activeEventCardHtml, /pm-today-trend-event-heading[\s\S]*?pm-today-trend-event-tags[\s\S]*?pm-today-trend-event-facts/, '事件追踪标签行必须位于标题行与内容区之间');
assert.match(activeEventCardHtml, /pm-today-trend-event-facts[\s\S]*?pm-today-trend-inline-actions[\s\S]*?pm-today-trend-event-history/, '进行中事件行内操作必须位于说明/事实区下方、阶段记录之前');
assert.match(todayTrendStyle, /pm-today-trend-event-body\{[^}]*gap:var\(--pm-space-2\)/, '事件追踪标题与标签行的既有间距必须保持不变');
assert.match(todayTrendStyle, /pm-today-trend-event-facts\{[^}]*gap:var\(--pm-space-0-5\)[^}]*margin-block-start:var\(--pm-today-trend-event-facts-start-offset\)[^}]*margin-block-end:var\(--pm-today-trend-event-facts-end-offset\)/, '事件事实区必须通过等值局部 token 保持既有上下间距');
assert.doesNotMatch(busyDynamicsHtml, /pm-today-trend-dynamics-signal|pm-today-trend-dynamics-arc/, '事件背景不得局限在模块子容器内或保留灰色弧线');
assert.doesNotMatch(busyDynamicsHtml, /pm-today-trend-progress|正在生成…/, '目标模块不得保留标题栏之外的重复生成状态');
assert.match(factionEditorHtml, /name="detailLabel"/, '势力编辑页必须提供动态关键资料编辑');
assert.match(factionEditorHtml, /name="status"/, '势力编辑页必须提供固定五档关系选择');
assert.match(factionEditorHtml, /class="pm-today-trend-detail-row"/, '势力资料行必须提供稳定语义 class');
assert.match(factionEditorHtml, /class="pm-today-trend-detail-add"[^>]*data-action="today-trend-add-detail"/, '添加资料必须提供独立语义 class 并保留动作契约');
assert.match(factionEditorHtml, /class="pm-today-trend-detail-remove"[^>]*data-action="today-trend-remove-detail"/, '删除资料必须提供次级危险语义 class 并保留动作契约');
assert.match(todayTrendStyle, /\.pm-today-trend-detail-add,\.pm-today-trend-detail-remove\{[^}]*min-height:var\(--pm-size-control-default\)[^}]*background:var\(--pm-color-surface-control\)[^}]*color:var\(--pm-color-text-primary\)/, '资料操作必须共享标准触控高度和 control 表面配方');
assert.match(todayTrendStyle, /\.pm-today-trend-detail-remove\{[^}]*color:var\(--pm-color-danger\)/, '删除资料必须使用次级危险文字而非大面积危险实底');
assert.match(todayTrendStyle, /\.pm-today-trend-detail-add:focus-visible,\.pm-today-trend-detail-remove:focus-visible\{[^}]*outline:var\(--pm-today-trend-focus-offset\) solid var\(--pm-color-focus-ring\)/, '资料操作必须提供统一 focus-visible 状态');
assert.match(todayTrendStyle, /\.pm-today-trend-content button:disabled\{opacity:var\(--pm-opacity-disabled\);cursor:not-allowed/, '资料达到上限时必须使用统一 disabled 视觉与交互状态');
assert.match(compactTodayTrendMedia, /pm-today-trend-detail-row\{grid-template-columns:minmax\(0,1fr\)/, '320px 窄屏资料行必须折叠为单列');
const maxDetailsScope = structuredClone(valid.scopes.chat);
maxDetailsScope.factions[0].details = Array.from({ length: TODAY_TREND_LIMITS.factionDetails }, (_, index) => ({ label: `资料${index}`, value: `值${index}` }));
assert.match(renderTodayTrendFactionView({ scope: maxDetailsScope, mode: 'editor', editingFactionId: 'red' }), /data-action="today-trend-add-detail" disabled/, '势力资料达到上限时，编辑器必须禁用添加入口');
const detailListeners = {};
let insertedDetailHtml = '';
const detailList = {
    children: Array.from({ length: TODAY_TREND_LIMITS.factionDetails - 1 }),
    insertAdjacentHTML: (_position, html) => { insertedDetailHtml = html; detailList.children.push({}); },
};
const detailFieldset = { querySelector: selector => selector === '[data-today-trend-details]' ? detailList : selector === '[data-action="today-trend-add-detail"]' ? detailAddButton : null };
const detailAddButton = { disabled: false, dataset: { action: 'today-trend-add-detail' }, closest: selector => selector === 'button[data-action]' ? detailAddButton : selector === 'fieldset' ? detailFieldset : null };
const detailRemoveButton = { dataset: { action: 'today-trend-remove-detail' }, closest: selector => selector === 'button[data-action]' ? detailRemoveButton : selector === 'fieldset' ? detailFieldset : null, parentElement: { remove: () => { detailList.children.pop(); } } };
const detailDispatcher = createTodayTrendActionDispatcher({
    container: { addEventListener: (type, listener) => { detailListeners[type] = listener; }, removeEventListener: () => {}, contains: () => true },
    getStorageId: () => 'chat', getStore: async () => valid, committer: { commitScope: async () => valid }, render: async () => {},
});
detailListeners.click({ target: detailAddButton });
assert.equal(detailList.children.length, TODAY_TREND_LIMITS.factionDetails, '势力资料第 16 条必须允许添加');
assert.match(insertedDetailHtml, /class="pm-today-trend-detail-row"[\s\S]*class="pm-today-trend-detail-remove"/, '动态添加的势力资料行必须复用相同语义 class');
assert.match(insertedDetailHtml, /class="pm-today-trend-input" name="detailLabel"[\s\S]*class="pm-today-trend-input" name="detailValue"/, '动态添加的资料输入必须复用编辑器输入配方');
assert.equal(detailAddButton.disabled, true, '势力资料达到上限后必须立即禁用添加入口');
detailListeners.click({ target: detailAddButton });
assert.equal(detailList.children.length, TODAY_TREND_LIMITS.factionDetails, '势力资料达到上限后不得添加第 17 条');
detailListeners.click({ target: detailRemoveButton });
assert.equal(detailList.children.length, TODAY_TREND_LIMITS.factionDetails - 1, '删除势力资料必须移除目标条目');
assert.equal(detailAddButton.disabled, false, '删除势力资料后必须重新启用添加入口');
detailDispatcher.destroy();
const externalFixture = fixture();
externalFixture.scopes.chat.factions.push({ id: 'rival', name: '蓝队', summary: '对手队伍', parentId: null, relatedFactionIds: ['red'], details: [], relation: { status: 'dislike', evaluation: '竞争激烈' } });
const externalScope = normalizeTodayTrendStore(externalFixture).scopes.chat;
const externalHtml = renderTodayTrendFactionView({ scope: externalScope });
assert.match(externalHtml, /data-faction-id="rival"[\s\S]*?pm-today-trend-faction-links[\s\S]*?红队/, '外部关联必须并入来源势力卡片并显示目标');
assert.doesNotMatch(externalHtml, /<h3[^>]*>外部关联<\/h3>/, '外部关联不得再作为独立区块展示');
const externalEditorHtml = renderTodayTrendFactionView({ scope: externalScope, mode: 'editor', editingFactionId: 'red' });
assert.match(externalEditorHtml, /name="relatedFactionIds"/, '势力编辑页必须在存在合法候选时提供外部关联多选');
assert.deepEqual(normalizeTodayTrendStore(valid), valid, '归一化必须幂等');
assert.equal(valid.scopes.chat.factions[1].parentId, 'red');
const inheritedScope = copyTodayTrendScope(valid.scopes.chat, 'branch-chat');
assert.equal(inheritedScope.storageId, 'branch-chat');
assert.equal(inheritedScope.presetId, 'preset', '分支 scope 必须继续引用共享预设');
assert.equal(inheritedScope.operation.lastSuccessfulAssistantCount, 0, '分支 scope 必须重置楼层 checkpoint');
assert.equal(inheritedScope.operation.lastSuccessfulRunAt, 0, '分支 scope 必须重置成功时间');
assert.deepEqual(inheritedScope.world, valid.scopes.chat.world, '分支 scope 必须保留已提交内容');
assertCode(() => ({ ...fixture(), version: 2 }), 'TT_STORE_VERSION');
assertCode(() => { const value = fixture(); value.scopes.chat.presetId = 'missing'; return value; }, 'TT_SCOPE_PRESET');
assertCode(() => { const value = fixture(); value.scopes.chat.factions[1].parentId = 'missing'; return value; }, 'TT_FACTION_PARENT');
assertCode(() => { const value = fixture(); value.scopes.chat.factions[0].parentId = 'station'; return value; }, 'TT_FACTION_CYCLE');
assertCode(() => { const value = fixture(); value.scopes.chat.factions[1].id = 'red'; return value; }, 'TT_DUPLICATE_ID');
assertCode(() => { const value = fixture(); value.scopes.chat.reputation.circles[0].status = 'friendly'; return value; }, 'TT_CIRCLE');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].lifecycle = 'archived'; return value; }, 'TT_EVENT_BUCKET');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.archived[0].outcome = null; return value; }, 'TT_EVENT_ARCHIVE');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.archived[0].finalResult = null; return value; }, 'TT_EVENT_ARCHIVE');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].outcome = 'resolved'; return value; }, 'TT_EVENT_ACTIVE');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].type = 'invalid'; return value; }, 'TT_EVENT');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].stageLabel = '短'; return value; }, 'TT_EVENT_STAGE');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].stageLabel = '一二三四五六七八九'; return value; }, 'TT_EVENT_STAGE');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].latestStage = '不一致'; return value; }, 'TT_EVENT_STAGE_HISTORY');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].stages = []; return value; }, 'TT_EVENT_STAGE_HISTORY');
assertCode(() => { const value = fixture(); value.scopes.chat.factions[0].relatedFactionIds = ['red']; return value; }, 'TT_FACTION_SELF');
assertCode(() => { const value = fixture(); value.scopes.chat.factions[0].relatedFactionIds = ['missing-faction']; return value; }, 'TT_FACTION_RELATED');
assertCode(() => { const value = fixture(); value.scopes.chat.factions[0].details = [{ label: '队长', value: '甲' }, { label: '队长', value: '乙' }]; return value; }, 'TT_FACTION_DETAILS');
assertCode(() => { const value = fixture(); value.scopes.chat.factions[1].relatedFactionIds = ['red']; return value; }, 'TT_FACTION_RELATION_OVERLAP');
assertCode(() => { const value = fixture(); value.scopes.chat.operation.enabled = 'true'; return value; }, 'TT_SCOPE');
assertCode(() => { const value = fixture(); value.scopes.chat.injection.enabled = 1; return value; }, 'TT_SCOPE');
const legacyInjection = fixture(); delete legacyInjection.scopes.chat.injection.minimalUi;
assert.equal(normalizeTodayTrendStore(legacyInjection).scopes.chat.injection.minimalUi, false, '旧资料缺少极简 UI 字段时必须兼容回退为关闭');
assertCode(() => { const value = fixture(); value.presets.preset.source.includeExistingChat = 1; return value; }, 'TT_PRESET');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].relatedEventIds = ['missing']; return value; }, 'TT_EVENT_RELATED');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].relatedEventIds = ['service']; return value; }, 'TT_EVENT_RELATED');
const crossLifecycleRelated = fixture();
crossLifecycleRelated.scopes.chat.dynamics.active[0].relatedEventIds = ['rumor'];
assert.deepEqual(
    normalizeTodayTrendStore(crossLifecycleRelated).scopes.chat.dynamics.active[0].relatedEventIds,
    ['rumor'],
    '事件关联必须允许引用同一次 dynamics 中的 archived 事件');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.archived[0].outcome = 'resolved'; return value; }, 'TT_EVENT_OUTCOME');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.archived[0] = { ...value.scopes.chat.dynamics.archived[0], type: 'normal', outcome: 'confirmed' }; return value; }, 'TT_EVENT_OUTCOME');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.archived[0] = { ...value.scopes.chat.dynamics.archived[0], type: 'underground', outcome: 'absorbed' }; return value; }, 'TT_EVENT_OUTCOME');

assertCode(() => { const value = fixture(); value.scopes.chat.dynamicsSettings.incident.probability = 101; return value; }, 'TT_DYNAMICS_SETTINGS');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamicsSettings.trackingLimit = 0; return value; }, 'TT_DYNAMICS_SETTINGS');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamicsSettings.trackingLimit = 1; value.scopes.chat.dynamics.active.push({ ...value.scopes.chat.dynamics.active[0], id: 'overflow', title: '额外动态' }); return value; }, 'TT_DYNAMICS_SETTINGS');

const advancedEventScope = advanceTodayTrendEvent(valid.scopes.chat, 'service', { stageLabel: '服务中', latestStage: '开始出餐', now: 10 });
assert.deepEqual(advancedEventScope.dynamics.active[0].stages, ['分配岗位', '检查食材', '开始出餐'], '推进事件必须保留完整阶段历史');
assert.equal(advancedEventScope.dynamics.active[0].latestStage, '开始出餐', '推进事件必须更新最新阶段');
assert.throws(() => advanceTodayTrendEvent(valid.scopes.chat, 'service', { stageLabel: '准备中', latestStage: '检查食材' }), error => error?.code === 'TT_EVENT_NO_PROGRESS', '仅实际进展设置必须拒绝重复阶段');
const repeatableStageScope = structuredClone(valid.scopes.chat);
repeatableStageScope.dynamicsSettings.appendOnlyOnActualProgress = false;
assert.equal(advanceTodayTrendEvent(repeatableStageScope, 'service', { stageLabel: '等待中', latestStage: '检查食材' }).dynamics.active[0].stages.at(-1), '检查食材', '关闭实际进展开关后必须允许记录重复阶段');
const archivedEventScope = archiveTodayTrendEvent(advancedEventScope, 'service', { outcome: 'resolved', finalResult: '服务顺利完成', now: 11 });
assert.equal(archivedEventScope.dynamics.active.length, 0, '归档事件必须退出 active 桶');
assert.equal(archivedEventScope.dynamics.archived.at(-1).outcome, 'resolved', '归档事件必须保存固定完结结果');
assert.throws(() => advanceTodayTrendEvent(archivedEventScope, 'service', { stageLabel: '已结束', latestStage: '不应推进' }), error => error?.code === 'TT_EVENT_NOT_ACTIVE', '归档事件不得继续推进');
assert.throws(() => archiveTodayTrendEvent(archivedEventScope, 'service', { outcome: 'resolved', finalResult: '不应重复归档' }), error => error?.code === 'TT_EVENT_NOT_ACTIVE', '归档事件不得重复归档');
const activeRumorScope = structuredClone(valid.scopes.chat);
activeRumorScope.dynamics.active.push({ ...activeRumorScope.dynamics.archived[0], id: 'active-rumor', lifecycle: 'active', stageLabel: '流传中', outcome: null, finalResult: null, relatedEventIds: [] });
activeRumorScope.dynamics.archived = [];
const settledRumorScope = settleTodayTrendRumor(activeRumorScope, 'active-rumor', { outcome: 'debunked', finalResult: '节目组公开澄清' });
assert.equal(settledRumorScope.dynamics.archived[0].outcome, 'debunked', '流言只能以证实或证伪结果归档');
const confirmedRumorScope = settleTodayTrendRumor(activeRumorScope, 'active-rumor', { outcome: 'confirmed', finalResult: '节目组确认传闻' });
assert.equal(confirmedRumorScope.dynamics.archived[0].outcome, 'confirmed', '流言必须支持证实归档');
assert.throws(() => settleTodayTrendRumor(activeRumorScope, 'active-rumor', { outcome: 'resolved', finalResult: '错误结果' }), error => error?.code === 'TT_EVENT_RUMOR', '流言不得以证实或证伪以外的结果归档');
assert.throws(() => archiveTodayTrendEvent(activeRumorScope, 'active-rumor', { outcome: 'resolved', finalResult: '绕过流言结算' }), error => error?.code === 'TT_EVENT_RUMOR', '流言不得绕过专用结算入口');
assert.throws(() => archiveTodayTrendEvent(valid.scopes.chat, 'service', { outcome: 'absorbed', finalResult: '错误承接' }), error => error?.code === 'TT_EVENT_OUTCOME', '普通归档不得伪造地下线承接结果');
const undergroundScope = structuredClone(valid.scopes.chat);
undergroundScope.dynamics.active[0] = { ...undergroundScope.dynamics.active[0], id: 'underground', type: 'underground', title: '后台交易', stageLabel: '接触中' };
undergroundScope.dynamics.archived[0].relatedEventIds = ['underground'];

const dynamicsHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, preset: valid.presets.preset, menuOpenId: 'dynamics-module' });
const archivedDynamicsHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, preset: valid.presets.preset, dynamicsTab: 'archived' });
const dynamicsHeaderHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, preset: valid.presets.preset, menuOpenId: 'dynamics-module', floorStatus: '<span data-today-trend-floor="7"></span>' });
assert.match(dynamicsHtml, /正在追踪/, '动态页必须区分正在追踪事件');
assert.match(dynamicsHtml, /已完结/, '动态页必须区分归档事件');
const dynamicsHeadHtml = dynamicsHeaderHtml.slice(dynamicsHeaderHtml.indexOf('<header class="pm-today-trend-module-head'), dynamicsHeaderHtml.indexOf('</header>') + '</header>'.length);
assert.ok(dynamicsHeadHtml.indexOf('<h2>事件追踪</h2>') < dynamicsHeadHtml.indexOf('today-trend-advance-all-events')
    && dynamicsHeadHtml.indexOf('today-trend-advance-all-events') < dynamicsHeadHtml.indexOf('today-trend-edit-dynamics-rule')
    && dynamicsHeadHtml.indexOf('today-trend-edit-dynamics-rule') < dynamicsHeadHtml.indexOf('today-trend-open-dynamics-settings'),
    '事件追踪模块头必须先居中输出标题，再按刷新、提示词、设置的顺序输出动作图标');
assert.match(dynamicsHeadHtml, /<h2>[\s\S]*?<\/h2>[\s\S]*?data-today-trend-floor/, '事件追踪楼层状态必须位于标题右侧');
assert.match(archivedDynamicsHtml, /事件归档/, '归档 tab 必须联动模块标题');
assert.match(dynamicsHtml, /pm-today-trend-module-head[\s\S]*?<\/header><div class="pm-today-trend-module-body">/, '事件追踪必须将主题色模块头与灰色内容层拆为相邻容器');
assert.match(archivedDynamicsHtml, /DONE[\s\S]*?TOTAL/, '归档 tab meta 必须由归档和总事件数映射');
assert.match(archivedDynamicsHtml, /pm-today-trend-dynamics-switch[^>]*data-tab="active"/, '归档视图切换按钮必须指向活跃 tab');
assert.match(archivedDynamicsHtml, /pm-today-trend-event-latest[\s\S]*?最终结果/, '归档事件必须始终外置最终结果');
assert.match(dynamicsHtml, /data-event-type="normal"/, '动态事件必须暴露类型样式钩子');
assert.match(dynamicsHtml, /today-trend-open-dynamics-settings/, '动态页必须提供设置入口');
assert.match(dynamicsHtml, /today-trend-edit-dynamics-rule/, '动态页必须提供模块提示词编辑入口');
assert.match(dynamicsHtml, /编辑事件追踪提示词/, '事件追踪入口必须使用中文提示词文案');
assert.doesNotMatch(dynamicsHtml, /编辑事件追踪 Prompt/, '事件追踪入口不得残留英文 Prompt');
const dynamicsSettingsHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, mode: 'settings' });
assert.match(dynamicsSettingsHtml, /name="incidentProbability"/, '动态设置必须提供突发概率输入');
assert.match(dynamicsSettingsHtml, /自动判断完结/, '动态设置必须区分自动判断完结');
assert.match(dynamicsSettingsHtml, /完结后归档/, '动态设置必须区分完结后归档');
const eventEditorHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, editingEventId: 'service' });
assert.match(eventEditorHtml, /<div class="pm-today-trend-module-body">[\s\S]*data-today-trend-form="event"/, '事件编辑页必须复用带横向留白和底部安全区的内容层');
const eventActionPair = eventEditorHtml.match(/<div class="pm-today-trend-form-actions pm-action-pair">[\s\S]*?<\/div>/)?.[0] || '';
assert.ok(eventActionPair, '事件编辑双操作区必须使用显式 pm-action-pair 契约');
assert.ok(eventActionPair.indexOf('today-trend-cancel-event-editor') < eventActionPair.indexOf('<button type="submit">保存</button>'),
    '事件编辑器必须按取消、保存的 DOM 与 Tab 顺序渲染');
assert.doesNotMatch(renderTodayTrendDynamicsView({ scope: activeRumorScope, editingEventId: 'archive:active-rumor' }), /value="resolved"/, '流言归档 UI 只能提供证实或证伪结果');
assert.doesNotMatch(renderTodayTrendDynamicsView({ scope: valid.scopes.chat, editingEventId: 'archive:service' }), /value="confirmed"|value="debunked"|value="absorbed"/, '普通事件归档 UI 不得暴露流言或承接结果');
const undergroundDynamicsHtml = renderTodayTrendDynamicsView({ scope: undergroundScope, menuOpenId: 'dynamics-module' });
const undergroundCardHtml = undergroundDynamicsHtml.match(/<article class="pm-today-trend-event-card[^>]*data-event-id="underground"[\s\S]*?<\/article>/)?.[0] || '';
assert.ok(undergroundCardHtml, '地下线事件必须渲染独立事件卡片');
assert.match(undergroundCardHtml, /today-trend-advance-event[\s\S]*?today-trend-edit-event[\s\S]*?today-trend-archive-event[\s\S]*?today-trend-promote-underground/, '地下线必须先输出标准三动作，再追加专属升级动作');
assert.equal((undergroundCardHtml.match(/pm-today-trend-inline-action(?:\s|")/g) || []).length, 4, '地下线事件必须恰好输出三个标准动作和一个专属升级动作');
assert.doesNotMatch(dynamicsHtml, /today-trend-promote-underground/, '非地下线事件不得输出升级动作');
const archivedActionsHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, dynamicsTab: 'archived', menuOpenId: 'dynamics-module' });
const archivedCardHtml = archivedActionsHtml.match(/<article class="pm-today-trend-event-card is-archived"[^>]*data-event-id="rumor"[\s\S]*?<\/article>/)?.[0] || '';
assert.ok(archivedCardHtml, '归档事件必须渲染独立事件卡片');
const archivedEventHeaderHtml = archivedCardHtml.match(/<header>[\s\S]*?<\/header>/)?.[0] || '';
assert.ok(archivedEventHeaderHtml, '归档事件卡片必须渲染独立标题栏片段');
assert.doesNotMatch(archivedEventHeaderHtml, /pm-today-trend-inline-actions/, '归档事件标题栏不得包含行内操作');
assert.match(archivedCardHtml, /today-trend-delete-event/, '归档事件必须保留删除动作');
assert.match(archivedCardHtml, /pm-today-trend-event-facts[\s\S]*?pm-today-trend-inline-actions[\s\S]*?pm-today-trend-event-history[\s\S]*?pm-today-trend-event-latest/, '归档事件必须按事实区、行内操作、阶段记录、最终结果顺序渲染');
assert.doesNotMatch(archivedCardHtml, /today-trend-(?:advance|edit|archive)-event|today-trend-promote-underground/, '归档事件不得重新开放推进、编辑、归档或升级动作');
assert.equal((archivedCardHtml.match(/pm-today-trend-inline-action(?:\s|")/g) || []).length, 1, '归档事件必须只输出一个删除动作');
assert.match(renderTodayTrendDynamicsView({ scope: undergroundScope, editingEventId: 'promote:underground' }), /data-today-trend-form="event-promotion"/, '地下线升级必须提供受控事件表单');
assert.doesNotMatch(dynamicsSettingsHtml, /today-trend-edit-(?:dynamics|incident|rumor|underground)-rule/, '动态设置不得重复提供模块规则入口');



const promotedScope = promoteTodayTrendUnderground(undergroundScope, 'underground', { id: 'incident', title: '后台冲突', stageLabel: '爆发中', origin: '交易曝光', participants: ['小明'], stages: ['工作人员介入'], latestStage: '工作人员介入' });
assert.equal(promotedScope.dynamics.archived.find(event => event.id === 'underground').outcome, 'absorbed', '地下线升级必须归档原事件');
assert.equal(promotedScope.dynamics.active.find(event => event.id === 'incident').type, 'incident', '地下线升级必须新建突发事件，不能改写历史类型');
const injectionScope = { ...valid.scopes.chat, injection: { enabled: true, minimalUi: false } };
const injection = renderTodayTrendInjection(injectionScope);
assert.equal(renderTodayTrendInjection({ ...injectionScope, injection: { enabled: false, minimalUi: false } }), '', '关闭正文注入时普通 UI 不得产生注入文本');
assert.equal(renderTodayTrendInjection({ ...injectionScope, injection: { enabled: false, minimalUi: true } }), '', '关闭正文注入时极简 UI 不得产生注入文本');
assert.equal(renderTodayTrendInjection({ ...injectionScope, injection: { enabled: true, minimalUi: true } }), injection, '开启正文注入时极简 UI 不得改变注入文本');
assert.match(injection, /主厨评审｜中立｜仍在观察/, '注入必须使用中文关系状态并包含完整圈层评价');
assert.match(injection, /红队｜喜欢｜认可配合能力/, '势力关系注入必须将内部英文状态转换为中文');
assert.doesNotMatch(injection, /｜(?:hostile|dislike|neutral|like|trust)｜/, '正文注入不得泄漏内部英文关系枚举');
assert.match(injection, /晚餐服务｜准备中｜检查食材/, '注入必须只包含 active 事件的最新阶段');
assert.doesNotMatch(injection, /换队传闻/, '已归档事件不得注入正文');
assert.equal(renderTodayTrendInjection(injectionScope, { maxLines: 1 }).split('\n').length, 2, '注入裁剪必须保持完整行和区块标题');


const memoryStorage = () => {
    const values = new Map();
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
};
const inactiveV2Authority = () => ({
    load: async () => ({ active: false, store: null, authority: null }),
    status: async () => ({ available: true, authority: null, owned: false }),
});
const primaryStorage = memoryStorage();
let primarySnapshot = null;
const persistentStorage = createTodayTrendStorage({
    idbGet: async () => primarySnapshot,
    idbSet: async (_key, value) => { primarySnapshot = structuredClone(value); return true; },
    storage: primaryStorage,
    v2Authority: inactiveV2Authority(),
});
await persistentStorage.save(valid);
assert.deepEqual(await persistentStorage.load(), valid, 'IDB 主存储必须可往返规范数据');
assert.equal(primaryStorage.getItem('ST_SMS_TODAY_TREND_V1_LOCAL_FALLBACK'), null, '主存储成功后必须清理后备快照');
const fallbackStorage = memoryStorage();
const fallbackPersistence = createTodayTrendStorage({
    idbGet: async () => { throw new Error('IDB unavailable'); },
    idbSet: async () => false,
    storage: fallbackStorage,
    v2Authority: inactiveV2Authority(),
});
await fallbackPersistence.save(valid);
assert.deepEqual(await fallbackPersistence.load(), valid, 'IDB 不可用时必须从 localStorage 后备数据恢复');

let forbiddenV1Reads = 0;
let forbiddenV1Writes = 0;
const unavailableBridge = createTodayTrendStorage({
    idbGet: async () => { forbiddenV1Reads += 1; return valid; },
    idbSet: async () => { forbiddenV1Writes += 1; return true; },
    storage: memoryStorage(),
    v2Authority: {
        load: async () => { const error = new Error('authority unavailable'); error.code = 'TT_V2_IDB_UNAVAILABLE'; throw error; },
        status: async () => ({ available: false, authority: null, owned: false }),
    },
});
await assert.rejects(() => unavailableBridge.load(), error => error?.code === 'TT_V2_IDB_UNAVAILABLE',
    'authority 不可确认时读取必须 fail-closed，不能返回无法证明新旧程度的 v1 数据');
assert.equal(forbiddenV1Reads, 0, 'authority 不可确认时不得继续读取 v1 IDB 或 fallback');
await assert.rejects(() => unavailableBridge.save(valid), error => error?.code === 'TT_V2_AUTHORITY_UNAVAILABLE',
    '兼容桥无法确认 authority 时必须拒绝写入，不能降级到 v1');
assert.equal(forbiddenV1Writes, 0, 'authority 不可确认时不得触发任何 v1 IDB 写入');

let busyAcquireCalls = 0;
let busySaveCalls = 0;
const busyAuthorityBridge = createTodayTrendStorage({
    storage: memoryStorage(),
    v2Authority: {
        load: async () => ({ active: true, store: valid, authority: null }),
        status: async () => ({ available: true, owned: false, authority: {
            ownerTabId: 'other-tab', readV2: true, writeV2: true, serveV2: false, storeRevision: 3,
        } }),
        acquire: async () => { busyAcquireCalls += 1; },
        save: async () => { busySaveCalls += 1; },
    },
});
await assert.rejects(() => busyAuthorityBridge.save(valid, { allowAuthorityAcquire: true }), error => error?.code === 'TT_AUTHORITY_BUSY',
    '备份临时 authority 不得抢夺其他标签的 active writer');
assert.deepEqual([busyAcquireCalls, busySaveCalls], [0, 0], 'active writer 存在时不得尝试 acquire 或 save');

let temporaryAuthorityStore = structuredClone(migratedValidV2);
let temporaryAuthority = null;
let temporaryAcquireCalls = 0;
let temporaryReleaseCalls = 0;
let temporaryInitialStore = null;
const temporaryAcquireStorage = createTodayTrendStorage({
    storage: memoryStorage(),
    v2Authority: {
        status: async () => ({ available: true, owned: temporaryAuthority?.ownerTabId === 'temporary-committer', authority: structuredClone(temporaryAuthority) }),
        acquire: async options => {
            temporaryAcquireCalls += 1;
            temporaryInitialStore = structuredClone(options.initialStore);
            temporaryAuthority = { ownerTabId: 'temporary-committer', readV2: true, writeV2: true, serveV2: false, storeRevision: 1 };
        },
        save: async value => {
            temporaryAuthorityStore = structuredClone(value);
            temporaryAuthority = { ...temporaryAuthority, storeRevision: temporaryAuthority.storeRevision + 1 };
            return { store: buildReadOnlyShadow(value), storeRevision: temporaryAuthority.storeRevision };
        },
        release: async (flags = {}) => {
            temporaryReleaseCalls += 1;
            temporaryAuthority = { ...temporaryAuthority, ownerTabId: null, writeV2: false, ...flags };
            return true;
        },
    },
});
const temporaryAcquireCommitter = createTodayTrendCommitter({
    loadCanonical: async () => structuredClone(migratedValidV2),
    save: temporaryAcquireStorage.save, storageStatus: temporaryAcquireStorage.status,
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }), journal: null,
});
const temporaryAcquireCommitted = await temporaryAcquireCommitter.commitStore(store => ({
    ...store, presets: { ...store.presets, preset: { ...store.presets.preset, name: '临时 authority 创建提交' } },
}));
assert.equal(temporaryAcquireCommitted.presets.preset.name, '临时 authority 创建提交',
    '无 writer 的 canonical 创建提交必须成功返回 facade');
assert.deepEqual([temporaryAcquireCalls, temporaryReleaseCalls], [1, 1],
    '无 writer 的 canonical 创建提交必须临时获取并释放 authority');
assert.equal(temporaryAuthority.ownerTabId, null, '创建提交完成后不得遗留 authority owner');
assert.equal(temporaryInitialStore.version, 1,
    'authority 记录尚不存在时必须以 facade 作为首次启用 v2 的 initialStore');

const primarySaveError = new Error('primary save failed');
primarySaveError.code = 'TT_PRIMARY_SAVE_FAILED';
const releaseFailure = new Error('release failed');
const dualFailureBridge = createTodayTrendStorage({
    storage: memoryStorage(),
    v2Authority: {
        load: async () => ({ active: true, store: valid, authority: null }),
        status: async () => ({ available: true, owned: false, authority: {
            ownerTabId: null, readV2: true, writeV2: false, serveV2: true, storeRevision: 3,
        } }),
        acquire: async () => {}, save: async () => { throw primarySaveError; }, release: async () => { throw releaseFailure; },
    },
});
await assert.rejects(() => dualFailureBridge.save(valid, { allowAuthorityAcquire: true }), error => {
    assert.equal(error, primarySaveError, '保存与释放同时失败时必须保留保存错误为主错误');
    assert.equal(error.releaseError, releaseFailure, '释放错误必须作为附加诊断保留');
    return true;
});
const releaseOnlyFailureBridge = createTodayTrendStorage({
    storage: memoryStorage(),
    v2Authority: {
        load: async () => ({ active: true, store: valid, authority: null }),
        status: async () => ({ available: true, owned: false, authority: {
            ownerTabId: null, readV2: true, writeV2: false, serveV2: false, storeRevision: 3,
        } }),
        acquire: async () => {}, save: async value => ({ store: value, storeRevision: 4 }), release: async () => { throw releaseFailure; },
    },
});
await assert.rejects(() => releaseOnlyFailureBridge.save(valid, { allowAuthorityAcquire: true }), error => {
    assert.equal(error?.code, 'TT_AUTHORITY_RELEASE_FAILED', '保存成功但临时 authority 释放失败时必须返回独立错误码');
    assert.equal(error.cause, releaseFailure, 'release-only failure 必须保留释放错误作为 cause');
    assert.equal(error.committedReceipt?.storeRevision, 4,
        'release-only failure 必须携带已提交 receipt，供上层执行 revision-fenced 补偿');
    return true;
});
const releaseFalseBridge = createTodayTrendStorage({
    storage: memoryStorage(),
    v2Authority: {
        load: async () => ({ active: true, store: valid, authority: null }),
        status: async () => ({ available: true, owned: false, authority: {
            ownerTabId: null, readV2: true, writeV2: false, serveV2: false, storeRevision: 3,
        } }),
        acquire: async () => {}, save: async value => ({ store: value, storeRevision: 4 }), release: async () => false,
    },
});
await assert.rejects(() => releaseFalseBridge.save(valid, { allowAuthorityAcquire: true }), error => {
    assert.equal(error?.code, 'TT_AUTHORITY_RELEASE_FAILED', 'release 返回 false 不得被 bridge 当作释放成功');
    assert.equal(error.cause?.code, 'TT_AUTHORITY_RELEASE_FAILED', 'release false 必须保留明确的底层释放错误码');
    assert.equal(error.committedReceipt?.storeRevision, 4,
        'release false 发生在 save 已提交后时仍必须携带 committed receipt');
    return true;
});

const createAuthorityHarness = () => {
    const records = new Map();
    const cloneValue = value => value === undefined ? undefined : structuredClone(value);
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const readEntry = async key => ({ ok: true, value: cloneValue(records.get(key)) });
    const compareAndSwap = async ({ guardKey, expectedGuard, writes }) => {
        if (!same(records.get(guardKey), expectedGuard)) return { ok: false, reason: 'CAS_CONFLICT' };
        for (const entry of writes) {
            if (entry.delete === true) records.delete(entry.key);
            else records.set(entry.key, cloneValue(entry.value));
        }
        return { ok: true };
    };
    return { records, readEntry, compareAndSwap };
};

const migrationHarness = createAuthorityHarness();
const migrationAuthority = createTodayTrendV2Authority({ ...migrationHarness, tabId: 'migration-owner', BroadcastChannelImpl: undefined });
const migrationResult = await migrationAuthority.migrate(valid, { sourceMedium: 'localStorage' });
assert.equal(migrationResult.migrated, true, '首次 v1→v2 迁移必须提交新 store');
assert.equal(migrationResult.storeRevision, 1, '首次迁移必须建立 store revision 1');
assert.deepEqual(migrationResult.store, valid, '首次迁移返回的只读影子必须保持 v1 用户可见语义');
const verifiedMigrationBackup = await migrationAuthority.readMigrationBackup();
assert.equal(verifiedMigrationBackup.state, 'verified', '首次迁移二次读取成功后必须将 migration backup 标记为 verified');
assert.equal(verifiedMigrationBackup.sourceMedium, 'localStorage', 'migration backup 必须保留真实迁移源介质');
const repeatedMigration = await migrationAuthority.migrate(valid);
assert.deepEqual({ migrated: repeatedMigration.migrated, storeRevision: repeatedMigration.storeRevision }, { migrated: false, storeRevision: 1 },
    '相同迁移源重复执行必须幂等且不得递增 revision');
const conflictingMigrationSource = structuredClone(valid);
conflictingMigrationSource.presets.preset.name = '冲突迁移源';
await assert.rejects(() => migrationAuthority.migrate(conflictingMigrationSource), error => error?.code === 'TT_MIGRATION_SOURCE_CONFLICT',
    '已有 v2 store 与新迁移源语义不同时必须拒绝覆盖');
await migrationAuthority.acquire({ readV2: true, writeV2: true, serveV2: false });
const postMigrationStore = structuredClone(valid);
postMigrationStore.presets.preset.name = '迁移后的合法修改';
const postMigrationReceipt = await migrationAuthority.save(postMigrationStore);
await migrationAuthority.release({ readV2: true, serveV2: false });
await assert.rejects(() => migrationAuthority.restoreBackup({
    v2Store: postMigrationReceipt.v2Store, migrationBackup: verifiedMigrationBackup,
}, { expectedStoreRevision: 0 }), error => error?.code === 'TT_STORE_REVISION_CONFLICT',
    '备份恢复必须用 expectedStoreRevision 拒绝覆盖迁移后的新 revision');
assert.equal((await migrationAuthority.status()).authority.storeRevision, 2,
    '备份 revision fence 被拒绝后不得改变持久化 authority');
const restoredPostMigration = await migrationAuthority.restoreBackup({
    v2Store: postMigrationReceipt.v2Store, migrationBackup: verifiedMigrationBackup,
}, { expectedStoreRevision: 2 });
assert.deepEqual(restoredPostMigration.store, postMigrationStore,
    '迁移后发生合法修改的 v2 store 必须能够连同原始 migration provenance 一起恢复');
assert.deepEqual(await migrationAuthority.readMigrationBackup(), verifiedMigrationBackup,
    '恢复当前 v2 store 时必须原样保留规范 migration provenance，不能重写为当前 store 镜像');
const restoredWithoutProvenance = await migrationAuthority.restoreBackup({
    v2Store: restoredPostMigration.v2Store, migrationBackup: null,
}, { expectedStoreRevision: 3 });
assert.equal(await migrationAuthority.readMigrationBackup(), null,
    '恢复 migrationBackup=null 必须在同一 CAS 中清除旧 provenance');
const nullProvenanceBridge = createTodayTrendStorage({
    idbGet: async () => conflictingMigrationSource, storage: memoryStorage(), v2Authority: migrationAuthority,
});
assert.deepEqual(await nullProvenanceBridge.load(), postMigrationStore,
    '清除 migration provenance 后兼容桥必须直接服务 v2 store，不得错误进入陈旧 v1 shadow 比较');
assert.deepEqual(await nullProvenanceBridge.captureV2Backup(), {
    v2Store: restoredWithoutProvenance.v2Store, migrationBackup: null, storeRevision: 4,
}, '清除 provenance 后再次捕获备份必须保持 migrationBackup=null');
migrationAuthority.close();

const convergedMigrationHarness = createAuthorityHarness();
let injectConcurrentMigration = true;
const convergedMigrationAuthority = createTodayTrendV2Authority({
    readEntry: convergedMigrationHarness.readEntry,
    compareAndSwap: async request => {
        if (injectConcurrentMigration) {
            injectConcurrentMigration = false;
            const concurrentStore = migrateTodayTrendStoreToV2(valid, { globalRevision: 1, scopeRevisionByStorageId: { chat: 1 } }).store;
            convergedMigrationHarness.records.set(TODAY_TREND_V2_STORAGE_KEY, createTodayTrendV2Envelope(concurrentStore, 1));
            convergedMigrationHarness.records.set(TODAY_TREND_V2_AUTHORITY_KEY, normalizeTodayTrendV2Authority({
                schemaVersion: 1, epoch: 1, authorityRevision: 1, storeRevision: 1, scopeRevisionByStorageId: { chat: 1 },
                ownerTabId: null, readV2: true, writeV2: false, serveV2: false,
            }));
            return { ok: false, reason: 'CAS_CONFLICT' };
        }
        return convergedMigrationHarness.compareAndSwap(request);
    },
    tabId: 'converged-migration', BroadcastChannelImpl: undefined,
});
const convergedMigration = await convergedMigrationAuthority.migrate(valid);
assert.deepEqual({ migrated: convergedMigration.migrated, storeRevision: convergedMigration.storeRevision }, { migrated: false, storeRevision: 1 },
    '并发迁移已提交相同语义结果时，失败方必须收敛到现有 v2 store');
convergedMigrationAuthority.close();

const verifyMissingHarness = createAuthorityHarness();
let hideMigratedPrimary = true;
const verifyMissingAuthority = createTodayTrendV2Authority({
    readEntry: async key => hideMigratedPrimary && key === TODAY_TREND_V2_STORAGE_KEY
        ? { ok: true, value: undefined } : verifyMissingHarness.readEntry(key),
    compareAndSwap: verifyMissingHarness.compareAndSwap,
    tabId: 'verify-missing', BroadcastChannelImpl: undefined,
});
await assert.rejects(() => verifyMissingAuthority.migrate(valid), error => error?.code === 'TT_MIGRATION_VERIFY_FAILED',
    '迁移首次 CAS 成功后二次读取不到 primary 必须明确报告验证失败');
assert.equal(verifyMissingHarness.records.get(TODAY_TREND_V1_MIGRATION_BACKUP_KEY).state, 'persisted',
    '二次读取失败时必须保留 persisted backup 供后续恢复');
hideMigratedPrimary = false;
assert.equal((await verifyMissingAuthority.migrate(valid)).migrated, false,
    '二次读取恢复后重复 migrate 必须幂等收敛现有 store');
assert.equal((await verifyMissingAuthority.readMigrationBackup()).state, 'verified',
    '二次读取恢复后重复 migrate 必须将 persisted backup 推进为 verified');
verifyMissingAuthority.close();

const verifyConflictHarness = createAuthorityHarness();
let verifyConflictCasCalls = 0;
const verifyConflictAuthority = createTodayTrendV2Authority({
    readEntry: verifyConflictHarness.readEntry,
    compareAndSwap: async request => {
        verifyConflictCasCalls += 1;
        if (verifyConflictCasCalls === 2) return { ok: false, reason: 'CAS_CONFLICT' };
        return verifyConflictHarness.compareAndSwap(request);
    },
    tabId: 'verify-conflict', BroadcastChannelImpl: undefined,
});
await assert.rejects(() => verifyConflictAuthority.migrate(valid), error => error?.code === 'TT_MIGRATION_VERIFY_CONFLICT',
    'verified backup 状态提交发生 CAS 冲突时必须保留独立错误码');
assert.equal(verifyConflictHarness.records.get(TODAY_TREND_V1_MIGRATION_BACKUP_KEY).state, 'persisted',
    'verified 状态 CAS 冲突后不得伪造 migration backup 已验证');
assert.equal((await verifyConflictAuthority.migrate(valid)).migrated, false,
    'verified 状态 CAS 冲突解除后重复 migrate 必须收敛现有 store');
assert.equal((await verifyConflictAuthority.readMigrationBackup()).state, 'verified',
    'verified 状态 CAS 冲突解除后重复 migrate 必须完成状态推进');
verifyConflictAuthority.close();

const authorityChannels = new Set();
class AuthorityBroadcastChannel {
    constructor(name) {
        this.name = name;
        this.listeners = new Set();
        this.closed = false;
        authorityChannels.add(this);
    }
    addEventListener(type, listener) {
        if (type === 'message') this.listeners.add(listener);
    }
    postMessage(data) {
        for (const channel of authorityChannels) {
            if (channel !== this && channel.name === this.name && !channel.closed) {
                for (const listener of channel.listeners) listener({ data: structuredClone(data) });
            }
        }
    }
    close() {
        this.closed = true;
        this.listeners.clear();
        authorityChannels.delete(this);
    }
}
const authorityHarness = createAuthorityHarness();
const authorityStorage = memoryStorage();
const authorityA = createTodayTrendV2Authority({
    ...authorityHarness, storage: authorityStorage, tabId: 'tab-a', BroadcastChannelImpl: AuthorityBroadcastChannel,
});
const authorityB = createTodayTrendV2Authority({
    ...authorityHarness, storage: authorityStorage, tabId: 'tab-b', BroadcastChannelImpl: AuthorityBroadcastChannel,
});
assert.equal(authorityChannels.size, 0, 'v2 authority 默认关闭时不得创建 BroadcastChannel');
await assert.rejects(() => authorityA.acquire({ readV2: true, writeV2: true }), error => error?.code === 'TT_V2_INITIAL_STORE_REQUIRED',
    '首次启用 v2 读取时缺少初始 store 必须 fail-closed');
const initialV2Authority = await authorityA.acquire({ readV2: true, writeV2: true, serveV2: false, initialStore: valid });
assert.deepEqual({ readV2: initialV2Authority.readV2, writeV2: initialV2Authority.writeV2, serveV2: initialV2Authority.serveV2 },
    { readV2: true, writeV2: true, serveV2: false }, 'authority acquire 必须保存三层开关且 serveV2 可独立关闭');
const repeatedV2Authority = await authorityA.acquire({ readV2: true, writeV2: true, serveV2: false });
assert.equal(repeatedV2Authority.epoch, initialV2Authority.epoch,
    '当前 owner 使用相同开关重复 acquire 必须幂等，不得无意义递增 epoch');
await assert.rejects(() => authorityA.acquire({ readV2: true, writeV2: true, serveV2: true }), error => error?.code === 'TT_AUTHORITY_BUSY',
    '当前 owner 变更开关前必须显式 release，不能通过重复 acquire 改写 authority');
assert.equal(authorityChannels.size, 1, 'authority acquire 必须按需创建一个失权通知 channel');
assert.equal(authorityHarness.records.get(TODAY_TREND_V2_AUTHORITY_KEY).storeRevision, 1, '首次激活必须在同一 CAS 建立 store revision');
assert.deepEqual((await authorityA.load()).store, valid, '首次激活必须原子写入可读取的 v2 primary');
const scopeChangedStore = structuredClone(valid);
scopeChangedStore.scopes.chat.operation.lastSuccessfulRunAt += 1;
await authorityA.save(scopeChangedStore, { scopeId: 'chat' });
assert.equal(authorityHarness.records.get(TODAY_TREND_V2_AUTHORITY_KEY).storeRevision, 2, '首次 v2 变更保存必须在激活 revision 后继续递增');
assert.equal(authorityHarness.records.get(TODAY_TREND_V2_AUTHORITY_KEY).scopeRevisionByStorageId.chat, 1, 'scope CAS 保存必须递增对应 scope revision');
assert.deepEqual((await authorityA.load()).store, scopeChangedStore, 'v2 primary 必须按 authority revision 往返规范 store');
const reorderedScopeStore = structuredClone(scopeChangedStore);
reorderedScopeStore.scopes.chat.operation = Object.fromEntries(Object.entries(reorderedScopeStore.scopes.chat.operation).reverse());
await authorityA.save(reorderedScopeStore);
assert.equal(authorityHarness.records.get(TODAY_TREND_V2_AUTHORITY_KEY).scopeRevisionByStorageId.chat, 1,
    'scope 对象键顺序变化不得被误判为业务变更并递增 revision');
const reorderedArrayStore = structuredClone(reorderedScopeStore);
reorderedArrayStore.scopes.chat.factions.reverse();
await authorityA.save(reorderedArrayStore, { scopeId: 'chat' });
assert.equal(authorityHarness.records.get(TODAY_TREND_V2_AUTHORITY_KEY).scopeRevisionByStorageId.chat, 2,
    'scope 数组顺序变化必须被识别为业务变更并递增 revision');
assert.deepEqual((await authorityA.load()).store.scopes.chat.factions.map(item => item.id),
    reorderedArrayStore.scopes.chat.factions.map(item => item.id), 'v2 store 必须保留 scope 数组的新顺序');
await assert.rejects(() => authorityA.save(valid, { scopeId: 'other' }), error => {
    assert.equal(error?.code, 'TT_SCOPE_REVISION_MISMATCH',
        '声明 scope 与 candidate 实际变化不一致时必须拒绝写入，不能漏记 scope revision');
    assert.equal(error?.message, '声明的 scope 变更范围与实际 candidate 不一致',
        '声明 scope 与 candidate 实际变化不一致时必须保留稳定中文错误文本');
    return true;
}, '声明 scope 与 candidate 实际变化不一致时必须 fail-closed');
await assert.rejects(() => authorityB.acquire({ readV2: true, writeV2: true, serveV2: false }), error => error?.code === 'TT_AUTHORITY_BUSY',
    '其他标签不得接管尚未显式释放的 active writer');
assert.equal((await authorityA.status()).owned, true, '被拒绝的 takeover 不得使当前 owner 失权');
assert.equal(await authorityA.release({ readV2: true, serveV2: false }), true, '当前 owner 必须先显式释放 authority');
const acquiredByB = await authorityB.acquire({ readV2: true, writeV2: true, serveV2: false });
assert.ok(acquiredByB.epoch > initialV2Authority.epoch, '显式交接后的后继 owner 必须使用严格递增 epoch');
await assert.rejects(() => authorityA.save(valid), error => error?.code === 'TT_AUTHORITY_LOST', '已释放的旧 writer 必须在 CAS 前拒绝写入');
assert.equal((await authorityA.status()).owned, false, '失权 owner 的 status 不得继续报告 owned');
const releasedStore = structuredClone(scopeChangedStore);
releasedStore.scopes.chat.operation.lastSuccessfulRunAt += 1;
await authorityB.save(releasedStore);
assert.equal(authorityHarness.records.get(TODAY_TREND_V2_AUTHORITY_KEY).storeRevision, 5, '新 owner 必须从当前 store revision 继续递增');
assert.equal(authorityHarness.records.get(TODAY_TREND_V2_AUTHORITY_KEY).scopeRevisionByStorageId.chat, 3,
    '整树保存未显式传 scopeId 时必须从前后 store 推导并递增变更 scope revision');
assert.equal(await authorityB.release(), true, '当前 owner 必须通过 CAS 释放 authority');
assert.deepEqual((await authorityB.load()).store, releasedStore, 'release 只释放 writer，v2 mutation 后不得回读陈旧 v1');
assert.equal(authorityChannels.size, 0, '失权 owner 与释放 owner 都必须立即关闭 BroadcastChannel');
authorityA.close();
authorityB.close();
assert.equal(authorityChannels.size, 0, 'authority close 必须释放全部 BroadcastChannel 资源');

const scopeMismatchHarness = createAuthorityHarness();
const scopeMismatchAuthority = createTodayTrendV2Authority({
    ...scopeMismatchHarness, tabId: 'scope-mismatch-owner', BroadcastChannelImpl: undefined,
});
await scopeMismatchAuthority.acquire({ readV2: true, writeV2: true, initialStore: valid });
const assertScopeMismatch = async (candidate, declaredScopeId) => {
    const recordsBefore = structuredClone([...scopeMismatchHarness.records]);
    await assert.rejects(() => scopeMismatchAuthority.save(candidate, { scopeId: declaredScopeId }), error => {
        assert.equal(error?.code, 'TT_SCOPE_REVISION_MISMATCH', '范围不一致必须保留稳定错误码');
        assert.equal(error?.message, '声明的 scope 变更范围与实际 candidate 不一致', '范围不一致必须保留原中文错误文本');
        return true;
    }, '声明范围与实际 scope 不一致时必须 fail-closed');
    assert.deepEqual([...scopeMismatchHarness.records], recordsBefore, '范围不一致不得写入 store、authority 或递增 revision');
};
const scopeMismatchBase = (await scopeMismatchAuthority.load()).v2Store;
const scopeCreatedCandidate = structuredClone(scopeMismatchBase);
scopeCreatedCandidate.globalEnvelope.payload.scopes.sibling = copyTodayTrendV2ScopeForBranch(
    scopeMismatchBase.globalEnvelope.payload.scopes.chat, 'sibling', 0,
    scopeMismatchBase.globalEnvelope.payload.presets,
);
await assertScopeMismatch(scopeCreatedCandidate, 'other');
await scopeMismatchAuthority.save(scopeCreatedCandidate, { scopeId: 'sibling' });
await assertScopeMismatch(scopeMismatchBase, 'other');
await scopeMismatchAuthority.save(scopeMismatchBase, { scopeId: 'sibling' });
assert.equal((await scopeMismatchAuthority.status()).owned, true,
    '范围不一致被拒绝后 authority 必须保持可用，正确范围提交必须可恢复');
assert.equal(await scopeMismatchAuthority.release(), true, '范围不一致专项 authority 必须释放');
scopeMismatchAuthority.close();

const fifoHarness = createAuthorityHarness();
let blockedSaveResolve;
let saveCasEnteredResolve;
const blockedSave = new Promise(resolve => { blockedSaveResolve = resolve; });
const saveCasEntered = new Promise(resolve => { saveCasEnteredResolve = resolve; });
let fifoCasCalls = 0;
const fifoAuthority = createTodayTrendV2Authority({
    readEntry: fifoHarness.readEntry,
    compareAndSwap: async request => {
        fifoCasCalls += 1;
        if (fifoCasCalls === 2) {
            saveCasEnteredResolve();
            await blockedSave;
        }
        return fifoHarness.compareAndSwap(request);
    },
    tabId: 'fifo-owner', BroadcastChannelImpl: undefined,
});
await fifoAuthority.acquire({ readV2: true, writeV2: true, initialStore: valid });
const fifoStore = structuredClone(valid);
fifoStore.scopes.chat.operation.lastSuccessfulRunAt += 2;
const queuedSave = fifoAuthority.save(fifoStore, { scopeId: 'chat' });
await saveCasEntered;
const queuedRelease = fifoAuthority.release({ readV2: true, serveV2: false });
assert.throws(() => fifoAuthority.close(), error => error?.code === 'TT_AUTHORITY_BUSY',
    'pending mutation 存在时 close 必须拒绝静默清空本地 token');
assert.equal(fifoCasCalls, 2, 'release 必须排在正在执行的 save 后，不能并发进入 CAS');
blockedSaveResolve();
const [fifoReceipt, fifoReleased] = await Promise.all([queuedSave, queuedRelease]);
assert.equal(fifoReceipt.storeRevision, 2, 'FIFO 中 save 必须先提交并返回 revision');
assert.equal(fifoReleased, true, 'FIFO 中 release 必须基于 save 的新 token 成功释放');
assert.equal(fifoHarness.records.get(TODAY_TREND_V2_AUTHORITY_KEY).ownerTabId, null,
    'save→release 交错完成后不得遗留 orphan owner');
assert.deepEqual(buildReadOnlyShadow(fifoHarness.records.get(TODAY_TREND_V2_STORAGE_KEY).payload), normalizeTodayTrendStore(fifoStore),
    'FIFO release 不得丢失排在前面的 save payload 或改变用户可见语义');
fifoAuthority.close();

const releaseConflictHarness = createAuthorityHarness();
let injectReleaseConflict = true;
const releaseConflictAuthority = createTodayTrendV2Authority({
    readEntry: releaseConflictHarness.readEntry,
    compareAndSwap: async request => {
        const current = releaseConflictHarness.records.get(TODAY_TREND_V2_AUTHORITY_KEY);
        if (injectReleaseConflict && current?.ownerTabId === 'release-conflict-owner'
            && request.writes.length === 1 && request.writes[0].value.ownerTabId === null) {
            injectReleaseConflict = false;
            releaseConflictHarness.records.set(TODAY_TREND_V2_AUTHORITY_KEY, {
                ...structuredClone(current), authorityRevision: current.authorityRevision + 1,
            });
            return { ok: false, reason: 'CAS_CONFLICT' };
        }
        return releaseConflictHarness.compareAndSwap(request);
    },
    tabId: 'release-conflict-owner', BroadcastChannelImpl: undefined,
});
await releaseConflictAuthority.acquire({ readV2: true, writeV2: true, initialStore: valid });
await assert.rejects(() => releaseConflictAuthority.release({ readV2: true, serveV2: false }),
    error => error?.code === 'TT_AUTHORITY_CONFLICT',
    'release CAS conflict 且 owner 仍属于当前 tab 时必须抛出可重试冲突，不能返回 false');
assert.equal((await releaseConflictAuthority.status()).owned, true,
    '可重试 release conflict 后必须从持久化 authority 恢复本地 token');
assert.throws(() => releaseConflictAuthority.close(), error => error?.code === 'TT_AUTHORITY_BUSY',
    'active owner 未 release 前 close 必须拒绝制造 orphan owner');
assert.equal(await releaseConflictAuthority.release({ readV2: true, serveV2: false }), true,
    'release conflict 后的显式重试必须能够释放恢复后的 token');
releaseConflictAuthority.close();

const concurrentHarness = createAuthorityHarness();
const concurrentA = createTodayTrendV2Authority({ ...concurrentHarness, tabId: 'race-a', BroadcastChannelImpl: undefined });
const concurrentB = createTodayTrendV2Authority({ ...concurrentHarness, tabId: 'race-b', BroadcastChannelImpl: undefined });
const race = await Promise.allSettled([
    concurrentA.acquire({ readV2: true, writeV2: true, initialStore: valid }),
    concurrentB.acquire({ readV2: true, writeV2: true, initialStore: valid }),
]);
assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, '双标签基于同一 guard 竞争时只能有一个 authority acquire 成功');
assert.equal(race.filter(result => result.status === 'rejected' && result.reason?.code === 'TT_AUTHORITY_CONFLICT').length, 1,
    '双标签竞争失败方必须得到明确 authority conflict');
const concurrentReleaseResults = await Promise.all([concurrentA.release(), concurrentB.release()]);
assert.deepEqual(concurrentReleaseResults.sort(), [false, true],
    '并发 acquire 的胜者必须显式 release，失败方 release 应稳定返回 false');
concurrentA.close();
concurrentB.close();

assert.throws(() => normalizeTodayTrendV2Authority({ schemaVersion: 2 }), error => error?.code === 'TT_V2_FUTURE_VERSION',
    '未来 authority schema 必须 fail-closed');
const authorityWithExtraField = {
    schemaVersion: 1, epoch: 1, authorityRevision: 1, storeRevision: 0, scopeRevisionByStorageId: {},
    ownerTabId: null, readV2: false, writeV2: false, serveV2: false, unexpected: true,
};
assert.throws(() => normalizeTodayTrendV2Authority(authorityWithExtraField), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'authority record 额外字段必须 fail-closed，不能静默丢弃');
const invalidAuthorityLoadHarness = createAuthorityHarness();
invalidAuthorityLoadHarness.records.set(TODAY_TREND_V2_AUTHORITY_KEY, authorityWithExtraField);
let invalidAuthorityLoadCasCalls = 0;
const invalidAuthorityLoad = createTodayTrendV2Authority({
    readEntry: invalidAuthorityLoadHarness.readEntry,
    compareAndSwap: async operation => {
        invalidAuthorityLoadCasCalls += 1;
        return invalidAuthorityLoadHarness.compareAndSwap(operation);
    },
    tabId: 'invalid-authority-reader', BroadcastChannelImpl: undefined,
});
await assert.rejects(() => invalidAuthorityLoad.load(), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'authority record 额外字段必须使 load 在任何持久化写入前失败');
assert.equal(invalidAuthorityLoadCasCalls, 0, '非法 authority load 不得触发 CAS 写入或修复性覆盖');
invalidAuthorityLoad.close();
assert.throws(() => normalizeTodayTrendV2Envelope({ schemaVersion: 4 }), error => error?.code === 'TT_V2_FUTURE_VERSION',
    '未来 v2 store schema 必须 fail-closed');
const splitHarness = createAuthorityHarness();
const splitPrimary = createTodayTrendV2Envelope(valid, 1);
splitHarness.records.set(TODAY_TREND_V2_AUTHORITY_KEY, normalizeTodayTrendV2Authority({
    schemaVersion: 1, epoch: 1, authorityRevision: 2, storeRevision: 1, scopeRevisionByStorageId: {},
    ownerTabId: 'split-owner', readV2: true, writeV2: true, serveV2: false,
}));
splitHarness.records.set(TODAY_TREND_V2_STORAGE_KEY, splitPrimary);
const splitStorage = memoryStorage();
const splitPayload = structuredClone(valid);
splitPayload.presets.preset.name = '冲突副本';
splitStorage.setItem(TODAY_TREND_V2_FALLBACK_KEY, JSON.stringify(createTodayTrendV2Envelope(splitPayload, 1)));
const splitAuthority = createTodayTrendV2Authority({ ...splitHarness, storage: splitStorage, tabId: 'split-reader', BroadcastChannelImpl: undefined });
await assert.rejects(() => splitAuthority.load(), error => error?.code === 'TT_STORAGE_SPLIT_BRAIN', '相同 revision 的主副本内容不同时必须阻断读取');
splitAuthority.close();
const unavailableAuthority = createTodayTrendV2Authority({
    readEntry: async () => ({ ok: false }), compareAndSwap: async () => ({ ok: false, reason: 'IDB_UNAVAILABLE' }),
    tabId: 'unavailable', BroadcastChannelImpl: undefined,
});
await assert.rejects(() => unavailableAuthority.acquire({ readV2: true, writeV2: true }), error => error?.code === 'TT_V2_IDB_UNAVAILABLE',
    'IDB 不可用时 v2 writer 必须 fail-closed，不能降级为 localStorage writer');
unavailableAuthority.close();

const createTransactionalDb = initialEntries => {
    const records = new Map(initialEntries.map(([key, value]) => [key, structuredClone(value)]));
    let queue = Promise.resolve();
    const db = {
        transaction(_storeName, mode) {
            assert.equal(mode, 'readwrite', '生产 CAS 必须打开 readwrite 事务');
            const writes = [];
            let getRequest = null;
            let guardKey = null;
            let aborted = false;
            const transaction = {
                abort() { aborted = true; },
                objectStore() {
                    return {
                        get(key) { guardKey = key; getRequest = {}; return getRequest; },
                        put(value, key) { writes.push({ key, value: structuredClone(value) }); },
                        delete(key) { writes.push({ key, delete: true }); },
                    };
                },
            };
            queue = queue.then(() => new Promise(resolve => queueMicrotask(() => {
                getRequest.result = records.has(guardKey) ? structuredClone(records.get(guardKey)) : undefined;
                getRequest.onsuccess?.();
                if (aborted) transaction.onabort?.();
                else {
                    for (const entry of writes) {
                        if (entry.delete === true) records.delete(entry.key);
                        else records.set(entry.key, entry.value);
                    }
                    transaction.oncomplete?.();
                }
                resolve();
            })));
            return transaction;
        },
    };
    return { db, records };
};
const realCasGuard = { epoch: 1, revision: 2 };
const realCasDb = createTransactionalDb([['guard', realCasGuard]]);
const [realCasA, realCasB] = await Promise.all([
    pmIDBCompareAndSwap({
        guardKey: 'guard', expectedGuard: realCasGuard,
        writes: [{ key: 'payload-a', value: { accepted: 'a' } }, { key: 'guard', value: { epoch: 2, revision: 3 } }],
        openIDB: async () => realCasDb.db,
    }),
    pmIDBCompareAndSwap({
        guardKey: 'guard', expectedGuard: realCasGuard,
        writes: [{ key: 'payload-b', value: { accepted: 'b' } }, { key: 'guard', value: { epoch: 3, revision: 3 } }],
        openIDB: async () => realCasDb.db,
    }),
]);
assert.deepEqual([realCasA.ok, realCasB.ok].sort(), [false, true], '真实 pmIDBCompareAndSwap 并发竞争必须只允许一个事务成功');
assert.equal(realCasDb.records.has('payload-a') !== realCasDb.records.has('payload-b'), true,
    'CAS 冲突事务的全部 writes 必须原子丢弃，不能留下部分 payload');
const deleteCasGuard = structuredClone(realCasDb.records.get('guard'));
realCasDb.records.set('stale', { remove: true });
assert.deepEqual(await pmIDBCompareAndSwap({
    guardKey: 'guard', expectedGuard: deleteCasGuard,
    writes: [{ key: 'stale', delete: true }, { key: 'replacement', value: { accepted: true } }],
    openIDB: async () => realCasDb.db,
}), { ok: true }, '真实 pmIDBCompareAndSwap 必须支持在同一事务中原子混合 delete 与 put');
assert.equal(realCasDb.records.has('stale'), false, 'CAS delete 成功后旧 key 必须不存在');
assert.deepEqual(realCasDb.records.get('replacement'), { accepted: true }, 'CAS delete 不得丢失同事务中的 put');
await assert.rejects(() => pmIDBCompareAndSwap({
    guardKey: 'guard', expectedGuard: deleteCasGuard,
    writes: [{ key: 'invalid', value: 1, delete: true }], openIDB: async () => realCasDb.db,
}), /恰好指定 value 或 delete=true/, 'CAS write 同时声明 value 与 delete 必须在事务前拒绝');
const missingDbResult = await pmIDBCompareAndSwap({
    guardKey: 'guard', expectedGuard: realCasGuard, writes: [{ key: 'payload', value: 1 }], openIDB: async () => null,
});
assert.deepEqual(missingDbResult, { ok: false, reason: 'IDB_UNAVAILABLE' }, '生产 CAS 必须区分数据库不可用与 guard 冲突');

const originalIndexedDB = globalThis.indexedDB;
try {
    const openRequests = [];
    globalThis.indexedDB = {
        open() {
            const request = {};
            openRequests.push(request);
            return request;
        },
    };
    const isolatedPmIdb = await import(`../src/pm-idb.js?open-lifecycle=${Date.now()}`);
    const firstOpen = isolatedPmIdb.pmOpenIDB();
    const concurrentOpen = isolatedPmIdb.pmOpenIDB();
    assert.equal(openRequests.length, 1, '首次并发 pmOpenIDB 必须共享同一个 pending open request');
    const firstConnection = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({}),
        closeCalls: 0,
        close() { this.closeCalls += 1; },
    };
    openRequests[0].result = firstConnection;
    openRequests[0].onsuccess();
    assert.equal(await firstOpen, firstConnection);
    assert.equal(await concurrentOpen, firstConnection, '并发调用必须解析为同一数据库连接');
    const firstVersionChange = firstConnection.onversionchange;
    firstVersionChange();
    assert.equal(firstConnection.closeCalls, 1, 'versionchange 必须关闭事件所属连接');
    const reopened = isolatedPmIdb.pmOpenIDB();
    assert.equal(openRequests.length, 2, 'versionchange 清除当前连接后必须允许重新打开');
    const secondConnection = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({}),
        closeCalls: 0,
        close() { this.closeCalls += 1; },
    };
    openRequests[1].result = secondConnection;
    openRequests[1].onsuccess();
    assert.equal(await reopened, secondConnection);
    firstVersionChange();
    assert.equal(secondConnection.closeCalls, 0, '旧连接的迟到 versionchange 不得关闭后来缓存的连接');
    assert.equal(await isolatedPmIdb.pmOpenIDB(), secondConnection, '旧连接事件不得清空后来连接的缓存');

    let synchronousOpenAttempts = 0;
    const synchronousRetryRequests = [];
    globalThis.indexedDB = {
        open() {
            synchronousOpenAttempts += 1;
            if (synchronousOpenAttempts === 1) throw new Error('injected synchronous open failure');
            const request = {};
            synchronousRetryRequests.push(request);
            return request;
        },
    };
    const synchronousRetryPmIdb = await import(`../src/pm-idb.js?open-sync-retry=${Date.now()}`);
    assert.equal(await synchronousRetryPmIdb.pmOpenIDB(), null,
        'indexedDB.open 同步抛错时 pmOpenIDB 必须返回 null');
    const synchronousRetry = synchronousRetryPmIdb.pmOpenIDB();
    assert.equal(synchronousOpenAttempts, 2, '同步打开失败后下一次调用必须重新发起 open');
    const synchronousRetryConnection = {
        objectStoreNames: { contains: () => true }, transaction: () => ({}), close() {},
    };
    synchronousRetryRequests[0].result = synchronousRetryConnection;
    synchronousRetryRequests[0].onsuccess();
    assert.equal(await synchronousRetry, synchronousRetryConnection,
        '同步打开失败不得让已完成的 openingPromise 永久阻断后续成功重试');

    const asynchronousRetryRequests = [];
    globalThis.indexedDB = {
        open() {
            const request = {};
            asynchronousRetryRequests.push(request);
            return request;
        },
    };
    const asynchronousRetryPmIdb = await import(`../src/pm-idb.js?open-async-retry=${Date.now()}`);
    const asynchronousFailure = asynchronousRetryPmIdb.pmOpenIDB();
    asynchronousRetryRequests[0].onerror();
    assert.equal(await asynchronousFailure, null, 'IDB open request error 时 pmOpenIDB 必须返回 null');
    const asynchronousRetry = asynchronousRetryPmIdb.pmOpenIDB();
    assert.equal(asynchronousRetryRequests.length, 2, '异步打开失败后下一次调用必须创建新的 open request');
    const asynchronousRetryConnection = {
        objectStoreNames: { contains: () => true }, transaction: () => ({}), close() {},
    };
    asynchronousRetryRequests[1].result = asynchronousRetryConnection;
    asynchronousRetryRequests[1].onsuccess();
    assert.equal(await asynchronousRetry, asynchronousRetryConnection,
        '异步打开失败不得缓存旧失败结果');
} finally {
    if (originalIndexedDB === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDB;
}

const sagaHarness = createAuthorityHarness();
const sagaCasWrites = [];
const sagaAuthority = createTodayTrendV2Authority({
    readEntry: sagaHarness.readEntry,
    compareAndSwap: async request => {
        sagaCasWrites.push(request.writes.map(entry => entry.key));
        return sagaHarness.compareAndSwap(request);
    },
    tabId: 'saga-owner', BroadcastChannelImpl: undefined,
});
await sagaAuthority.acquire({ readV2: true, writeV2: true, initialStore: valid });
let sagaNow = 1000;
const sagaPhases = [];
const createSagaJournal = () => createTodayTrendJournal({
    listKeys: async () => [...sagaHarness.records.keys()],
    readEntry: sagaHarness.readEntry,
    writeEntry: async (key, value) => {
        sagaHarness.records.set(key, structuredClone(value));
        sagaPhases.push(value.phase);
        return true;
    },
    deleteEntry: async key => sagaHarness.records.delete(key),
    now: () => ++sagaNow,
    transactionId: () => `saga-${sagaNow}`,
});
const sagaJournal = createSagaJournal();
const invalidTransitionEntry = await sagaJournal.begin({
    scopeId: 'chat', affectedScopeIds: ['chat'], baseStoreRevision: 1, previous: valid, candidate: valid,
});
await assert.rejects(() => sagaJournal.transition(invalidTransitionEntry, 'injection-written'),
    error => error?.code === 'TT_JOURNAL_TRANSITION_INVALID',
    'journal 必须拒绝 prepared 直接跳到 injection-written');
assert.throws(() => normalizeTodayTrendJournal({ ...invalidTransitionEntry, phase: 'store-written' }),
    error => error?.code === 'TT_JOURNAL_INVALID',
    '持久化 store-written journal 缺少 candidate revision 时必须在反序列化边界拒绝');
assert.throws(() => normalizeTodayTrendJournal({
    ...invalidTransitionEntry, phase: 'compensation-store-written', candidateStoreRevision: 2, compensationStoreRevision: 4,
}), error => error?.code === 'TT_JOURNAL_INVALID',
    '持久化 compensation journal 的 revision 不连续时必须明确拒绝而不是误报 split-brain');
assert.throws(() => normalizeTodayTrendJournal({
    ...invalidTransitionEntry, phase: 'store-written', candidateStoreRevision: 2, compensationStoreRevision: 3,
}), error => error?.code === 'TT_JOURNAL_INVALID',
    '数值连续的 compensation revision 出现在 store-written phase 时也必须拒绝');
assert.doesNotThrow(() => normalizeTodayTrendJournal({ ...invalidTransitionEntry, phase: 'rejected' }),
    'prepared 直接 rejected 必须允许不携带已提交 revision');
assert.throws(() => normalizeTodayTrendJournal({
    ...invalidTransitionEntry, phase: 'rejected', candidateStoreRevision: 2,
}), error => error?.code === 'TT_JOURNAL_INVALID',
    '状态机不可达的 candidate-only rejected journal 必须拒绝');
assert.doesNotThrow(() => normalizeTodayTrendJournal({
    ...invalidTransitionEntry, phase: 'rejected', candidateStoreRevision: 2, compensationStoreRevision: 3,
}), '补偿完成后的 rejected journal 必须允许连续的 candidate 与 compensation revision');
assert.doesNotThrow(() => normalizeTodayTrendJournal({ ...invalidTransitionEntry, phase: 'blocked' }),
    'prepared 阶段 blocked 必须允许不携带已提交 revision');
assert.doesNotThrow(() => normalizeTodayTrendJournal({
    ...invalidTransitionEntry, phase: 'blocked', candidateStoreRevision: 2,
}), 'candidate 已提交后的 blocked 必须允许只携带 candidate revision');
assert.doesNotThrow(() => normalizeTodayTrendJournal({
    ...invalidTransitionEntry, phase: 'blocked', candidateStoreRevision: 2, compensationStoreRevision: 3,
}), '补偿 store 已提交后的 blocked 必须允许连续的两级 revision');
assert.throws(() => normalizeTodayTrendJournal({
    ...invalidTransitionEntry, phase: 'blocked', compensationStoreRevision: 2,
}), error => error?.code === 'TT_JOURNAL_INVALID',
    'blocked journal 不得只携带 compensation revision');
await sagaJournal.complete(invalidTransitionEntry, 'rejected');

const sagaStorage = createTodayTrendStorage({ v2Authority: sagaAuthority, journal: sagaJournal, storage: memoryStorage() });
const sagaRuntime = {};
const sagaRefreshes = [];
let sagaPrepareCalls = 0;
const sagaCommitter = createTodayTrendCommitter({
    runtime: sagaRuntime, load: sagaStorage.load, save: sagaStorage.save, storageStatus: sagaStorage.status, journal: sagaJournal,
    prepareInjection: async () => { sagaPrepareCalls += 1; },
    refreshInjection: async store => { sagaRefreshes.push(structuredClone(store)); return { failedWrites: 0, failedKeys: [] }; },
});
const sagaAccepted = await sagaCommitter.commitScope('chat', scope => ({
    ...scope, operation: { ...scope.operation, lastSuccessfulRunAt: scope.operation.lastSuccessfulRunAt + 10 },
}));
assert.equal(sagaPrepareCalls, 1, '双写提交必须在 store CAS 前执行纯注入预检');
assert.equal(sagaRefreshes.length, 1, '双写提交成功后只能执行一次真实 candidate 注入');
assert.equal(sagaRuntime.pendingInjectionStore, undefined, '双写提交结束后不得泄漏 pending injection override');
assert.ok(sagaCasWrites.some(keys => keys.length === 3 && keys.some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX))),
    'candidate store、authority 与 store-written journal 必须进入同一个 CAS writes');
assert.equal([...sagaHarness.records.keys()].some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX)), false,
    'accepted journal 必须在终态持久化后清理开放记录');
assert.equal(sagaAccepted.scopes.chat.operation.lastSuccessfulRunAt,
    valid.scopes.chat.operation.lastSuccessfulRunAt + 10, 'saga 成功必须返回 candidate store');

const beforeSagaCompensation = structuredClone(await sagaStorage.load());
let compensationInjectionCalls = 0;
const compensatingSaga = createTodayTrendCommitter({
    runtime: {}, load: sagaStorage.load, save: sagaStorage.save, storageStatus: sagaStorage.status, journal: sagaJournal,
    prepareInjection: async () => {},
    refreshInjection: async () => {
        compensationInjectionCalls += 1;
        return compensationInjectionCalls === 1 ? { failedWrites: 1, failedKeys: [] } : { failedWrites: 0, failedKeys: [] };
    },
});
await assert.rejects(() => compensatingSaga.commitScope('chat', scope => ({
    ...scope, operation: { ...scope.operation, lastSuccessfulRunAt: scope.operation.lastSuccessfulRunAt + 1 },
})), /注入刷新失败/, 'candidate 注入失败必须抛回原始失败');
assert.equal(compensationInjectionCalls, 2, 'candidate 注入失败后必须只补偿一次 previous 注入');
assert.deepEqual(await sagaStorage.load(), beforeSagaCompensation, '补偿 CAS 必须恢复提交前 store');
assert.ok(sagaCasWrites.some(keys => keys.length === 3 && keys.some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX))),
    '补偿 store、authority 与 compensation-store-written journal 必须同事务提交');
assert.ok(sagaPhases.includes('compensation-requested') && sagaPhases.includes('rejected'),
    '注入失败必须留下 compensation-requested 到 rejected 的可诊断 phase 轨迹');

const recoveryPrevious = structuredClone(await sagaStorage.load());
const recoveryCandidate = structuredClone(recoveryPrevious);
recoveryCandidate.scopes.chat.operation.lastSuccessfulRunAt += 20;
const recoveryStatus = await sagaStorage.status();
const recoveryEntry = await sagaJournal.begin({
    scopeId: 'chat', affectedScopeIds: ['chat'], baseStoreRevision: recoveryStatus.authority.storeRevision,
    previous: recoveryPrevious, candidate: recoveryCandidate,
});
const recoveryWrite = sagaJournal.atomicTransition(recoveryEntry, 'store-written', {
    candidateStoreRevision: recoveryStatus.authority.storeRevision + 1,
});
await sagaStorage.save(recoveryCandidate, {
    scopeId: 'chat', changedScopeIds: ['chat'], expectedStoreRevision: recoveryStatus.authority.storeRevision,
    transactionId: recoveryEntry.transactionId, journalWrite: recoveryWrite, returnReceipt: true,
});
const restartedJournal = createSagaJournal();
let recoveryRefreshes = 0;
const restartedCommitter = createTodayTrendCommitter({
    runtime: {}, load: sagaStorage.load, save: sagaStorage.save, storageStatus: sagaStorage.status, journal: restartedJournal,
    refreshInjection: async store => {
        recoveryRefreshes += 1;
        assert.equal(todayTrendStoreDigest(store), todayTrendStoreDigest(recoveryCandidate));
        return { failedWrites: 0, failedKeys: [] };
    },
});
for (let index = 0; index < 20; index += 1) await restartedCommitter.ready();
assert.equal(recoveryRefreshes, 1, '同一启动恢复循环重复等待 20 次只能重放一次 candidate 注入');
assert.equal([...sagaHarness.records.keys()].some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX)), false,
    'store-written 恢复成功后必须清理 terminal journal');
await sagaJournal.reload();
const preparedPrevious = structuredClone(await sagaStorage.load());
const preparedStatus = await sagaStorage.status();
await sagaJournal.begin({
    scopeId: 'chat', affectedScopeIds: ['chat'], baseStoreRevision: preparedStatus.authority.storeRevision,
    previous: preparedPrevious, candidate: structuredClone(preparedPrevious),
});
let preparedRecoveryRefreshes = 0;
const preparedRecovery = createTodayTrendCommitter({
    runtime: {}, load: sagaStorage.load, save: sagaStorage.save, storageStatus: sagaStorage.status, journal: createSagaJournal(),
    refreshInjection: async () => { preparedRecoveryRefreshes += 1; },
});
await preparedRecovery.ready();
assert.equal(preparedRecoveryRefreshes, 0, 'prepared 恢复必须直接 rejected，不得执行真实注入');
await sagaJournal.reload();

const injectionWrittenPrevious = structuredClone(await sagaStorage.load());
const injectionWrittenCandidate = structuredClone(injectionWrittenPrevious);
injectionWrittenCandidate.scopes.chat.operation.lastSuccessfulRunAt += 30;
const injectionWrittenStatus = await sagaStorage.status();
let injectionWrittenEntry = await sagaJournal.begin({
    scopeId: 'chat', affectedScopeIds: ['chat'], baseStoreRevision: injectionWrittenStatus.authority.storeRevision,
    previous: injectionWrittenPrevious, candidate: injectionWrittenCandidate,
});
const injectionWrittenAtomic = sagaJournal.atomicTransition(injectionWrittenEntry, 'store-written', {
    candidateStoreRevision: injectionWrittenStatus.authority.storeRevision + 1,
});
await sagaStorage.save(injectionWrittenCandidate, {
    scopeId: 'chat', changedScopeIds: ['chat'], expectedStoreRevision: injectionWrittenStatus.authority.storeRevision,
    transactionId: injectionWrittenEntry.transactionId, journalWrite: injectionWrittenAtomic, returnReceipt: true,
});
injectionWrittenEntry = sagaJournal.acceptAtomicTransition(injectionWrittenAtomic.value);
await sagaJournal.transition(injectionWrittenEntry, 'injection-written');
let injectionWrittenRefreshes = 0;
const injectionWrittenRecovery = createTodayTrendCommitter({
    runtime: {}, load: sagaStorage.load, save: sagaStorage.save, storageStatus: sagaStorage.status, journal: createSagaJournal(),
    refreshInjection: async () => { injectionWrittenRefreshes += 1; },
});
await injectionWrittenRecovery.ready();
assert.equal(injectionWrittenRefreshes, 0, 'injection-written 恢复只能收尾 accepted，不得重复注入');
await sagaJournal.reload();

const requestedPrevious = structuredClone(await sagaStorage.load());
const requestedCandidate = structuredClone(requestedPrevious);
requestedCandidate.scopes.chat.operation.lastSuccessfulRunAt += 40;
const requestedStatus = await sagaStorage.status();
let requestedEntry = await sagaJournal.begin({
    scopeId: 'chat', affectedScopeIds: ['chat'], baseStoreRevision: requestedStatus.authority.storeRevision,
    previous: requestedPrevious, candidate: requestedCandidate,
});
const requestedAtomic = sagaJournal.atomicTransition(requestedEntry, 'store-written', {
    candidateStoreRevision: requestedStatus.authority.storeRevision + 1,
});
const requestedReceipt = await sagaStorage.save(requestedCandidate, {
    scopeId: 'chat', changedScopeIds: ['chat'], expectedStoreRevision: requestedStatus.authority.storeRevision,
    transactionId: requestedEntry.transactionId, journalWrite: requestedAtomic, returnReceipt: true,
});
requestedEntry = sagaJournal.acceptAtomicTransition(requestedAtomic.value);
await sagaJournal.transition(requestedEntry, 'compensation-requested', { lastErrorCode: 'TT_TEST_RECOVERY' });
let requestedRefreshDigest = null;
const requestedRecovery = createTodayTrendCommitter({
    runtime: {}, load: sagaStorage.load, save: sagaStorage.save, storageStatus: sagaStorage.status, journal: createSagaJournal(),
    refreshInjection: async store => { requestedRefreshDigest = todayTrendStoreDigest(store); return { failedWrites: 0, failedKeys: [] }; },
});
await requestedRecovery.ready();
assert.equal(requestedReceipt.storeRevision + 1, (await sagaStorage.status()).authority.storeRevision,
    'compensation-requested 恢复必须基于 candidate revision 原子递增一次');
assert.equal(requestedRefreshDigest, todayTrendStoreDigest(requestedPrevious),
    'compensation-requested 恢复必须重放 previous 注入');
assert.deepEqual(await sagaStorage.load(), requestedPrevious, 'compensation-requested 恢复必须还原 previous store');
await sagaJournal.reload();

const failedRecoveryPrevious = structuredClone(await sagaStorage.load());
const failedRecoveryCandidate = structuredClone(failedRecoveryPrevious);
failedRecoveryCandidate.scopes.chat.operation.lastSuccessfulRunAt += 50;
const failedRecoveryStatus = await sagaStorage.status();
const failedRecoveryEntry = await sagaJournal.begin({
    scopeId: 'chat', affectedScopeIds: ['chat'], baseStoreRevision: failedRecoveryStatus.authority.storeRevision,
    previous: failedRecoveryPrevious, candidate: failedRecoveryCandidate,
});
const failedRecoveryAtomic = sagaJournal.atomicTransition(failedRecoveryEntry, 'store-written', {
    candidateStoreRevision: failedRecoveryStatus.authority.storeRevision + 1,
});
await sagaStorage.save(failedRecoveryCandidate, {
    scopeId: 'chat', changedScopeIds: ['chat'], expectedStoreRevision: failedRecoveryStatus.authority.storeRevision,
    transactionId: failedRecoveryEntry.transactionId, journalWrite: failedRecoveryAtomic, returnReceipt: true,
});
let failedRecoveryRefreshes = 0;
const failedRecoveryCommitter = createTodayTrendCommitter({
    runtime: {}, load: sagaStorage.load, save: sagaStorage.save, storageStatus: sagaStorage.status, journal: createSagaJournal(),
    refreshInjection: async () => {
        failedRecoveryRefreshes += 1;
        return failedRecoveryRefreshes === 1 ? { failedWrites: 1, failedKeys: [] } : { failedWrites: 0, failedKeys: [] };
    },
});
await failedRecoveryCommitter.ready();
assert.equal(failedRecoveryRefreshes, 2, 'store-written 恢复注入失败后必须补偿 previous 注入，而不是直接 blocked');
assert.deepEqual(await sagaStorage.load(), failedRecoveryPrevious, 'store-written 恢复注入失败后必须还原 previous store');
assert.equal(failedRecoveryCommitter.isBlocked(), false, '可成功补偿的恢复失败不得升级为 blocked');
await sagaJournal.reload();

const compensationCrashPrevious = structuredClone(await sagaStorage.load());
const compensationCrashCandidate = structuredClone(compensationCrashPrevious);
compensationCrashCandidate.scopes.chat.operation.lastSuccessfulRunAt += 60;
const compensationCrashStatus = await sagaStorage.status();
let compensationCrashEntry = await sagaJournal.begin({
    scopeId: 'chat', affectedScopeIds: ['chat'], baseStoreRevision: compensationCrashStatus.authority.storeRevision,
    previous: compensationCrashPrevious, candidate: compensationCrashCandidate,
});
const compensationCrashStoreWrite = sagaJournal.atomicTransition(compensationCrashEntry, 'store-written', {
    candidateStoreRevision: compensationCrashStatus.authority.storeRevision + 1,
});
const compensationCrashReceipt = await sagaStorage.save(compensationCrashCandidate, {
    scopeId: 'chat', changedScopeIds: ['chat'], expectedStoreRevision: compensationCrashStatus.authority.storeRevision,
    transactionId: compensationCrashEntry.transactionId, journalWrite: compensationCrashStoreWrite, returnReceipt: true,
});
compensationCrashEntry = sagaJournal.acceptAtomicTransition(compensationCrashStoreWrite.value);
compensationCrashEntry = await sagaJournal.transition(compensationCrashEntry, 'compensation-requested', {
    lastErrorCode: 'TT_TEST_COMPENSATION_CRASH',
});
const compensationCrashWrite = sagaJournal.atomicTransition(compensationCrashEntry, 'compensation-store-written', {
    compensationStoreRevision: compensationCrashReceipt.storeRevision + 1,
});
await sagaStorage.save(compensationCrashPrevious, {
    scopeId: 'chat', changedScopeIds: ['chat'], expectedStoreRevision: compensationCrashReceipt.storeRevision,
    transactionId: compensationCrashEntry.transactionId, journalWrite: compensationCrashWrite, returnReceipt: true,
});
let compensationCrashRefreshes = 0;
const compensationCrashRecovery = createTodayTrendCommitter({
    runtime: {}, load: sagaStorage.load, save: sagaStorage.save, storageStatus: sagaStorage.status, journal: createSagaJournal(),
    refreshInjection: async store => {
        compensationCrashRefreshes += 1;
        assert.equal(todayTrendStoreDigest(store), todayTrendStoreDigest(compensationCrashPrevious));
        return { failedWrites: 0, failedKeys: [] };
    },
});
await compensationCrashRecovery.ready();
assert.equal(compensationCrashRefreshes, 1,
    'compensation-store-written 重启恢复必须只重放一次 previous 注入');
assert.deepEqual(await sagaStorage.load(), compensationCrashPrevious,
    'compensation-store-written 重启恢复不得改写已补偿的 previous store');
await sagaJournal.reload();

const splitBrainPrevious = structuredClone(await sagaStorage.load());
const splitBrainStatus = await sagaStorage.status();
const splitBrainEntry = await sagaJournal.begin({
    scopeId: 'chat', affectedScopeIds: ['chat'], baseStoreRevision: splitBrainStatus.authority.storeRevision,
    previous: splitBrainPrevious, candidate: structuredClone(splitBrainPrevious),
});
const splitBrainStoredEnvelope = structuredClone(sagaHarness.records.get(TODAY_TREND_V2_STORAGE_KEY));
const splitBrainTamperedEnvelope = structuredClone(splitBrainStoredEnvelope);
splitBrainTamperedEnvelope.payload.globalEnvelope.payload.scopes.chat.payload.operation.lastSuccessfulRunAt += 1;
sagaHarness.records.set(TODAY_TREND_V2_STORAGE_KEY, splitBrainTamperedEnvelope);
let splitBrainRefreshes = 0;
const splitBrainJournal = createSagaJournal();
const splitBrainCommitter = createTodayTrendCommitter({
    runtime: {}, load: sagaStorage.load, loadCanonical: sagaStorage.loadCanonical, save: sagaStorage.save,
    storageStatus: sagaStorage.status, journal: splitBrainJournal,
    refreshInjection: async () => { splitBrainRefreshes += 1; return { failedWrites: 0, failedKeys: [] }; },
});
await assert.rejects(() => splitBrainCommitter.ready(), error => error?.code === 'TT_RECOVERY_SPLIT_BRAIN',
    'prepared journal 的 revision 即使相同，当前权威 store digest 漂移也必须 blocked');
assert.equal(splitBrainRefreshes, 0, 'split-brain 恢复不得刷新任何 previous 或 candidate 注入');
assert.equal(splitBrainCommitter.isBlocked(), true, '权威 store digest 漂移必须持久化 blocked journal');
assert.deepEqual(sagaHarness.records.get(TODAY_TREND_V2_STORAGE_KEY), splitBrainTamperedEnvelope,
    'split-brain 检测不得用 journal 快照覆盖当前权威 store');
sagaHarness.records.set(TODAY_TREND_V2_STORAGE_KEY, splitBrainStoredEnvelope);
sagaHarness.records.delete([...sagaHarness.records.keys()].find(key => key.includes(splitBrainEntry.transactionId)));
await sagaJournal.reload();

const blockedStatus = await sagaStorage.status();
const blockedEntry = await sagaJournal.begin({
    scopeId: 'chat', affectedScopeIds: ['chat'], baseStoreRevision: blockedStatus.authority.storeRevision,
    previous: compensationCrashPrevious, candidate: compensationCrashPrevious,
});
await sagaJournal.markBlocked(blockedEntry, Object.assign(new Error('persistent blocked evidence'), { code: 'TT_TEST_BLOCKED' }));
const blockedJournal = createSagaJournal();
const blockedCommitter = createTodayTrendCommitter({
    runtime: {}, load: sagaStorage.load, save: sagaStorage.save, storageStatus: sagaStorage.status, journal: blockedJournal,
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
assert.deepEqual(await blockedCommitter.ready(), [false],
    '真实 blocked journal 重启后必须保留而不是自动恢复或清理');
assert.equal(blockedCommitter.isBlocked(), true, '真实 blocked journal 重启后必须继续报告 blocked');
await assert.rejects(() => blockedCommitter.commitStore(store => store),
    error => error?.code === 'TT_TRANSACTION_BLOCKED', '真实 blocked journal 必须阻止后续 store 提交');
for (const key of [...sagaHarness.records.keys()]) {
    if (key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX)) sagaHarness.records.delete(key);
}
await sagaJournal.reload();

const terminalRecords = new Map();
let terminalDeleteAttempts = 0;
const terminalJournal = createTodayTrendJournal({
    listKeys: async () => [...terminalRecords.keys()],
    readEntry: async key => ({ ok: true, value: structuredClone(terminalRecords.get(key)) }),
    writeEntry: async (key, value) => { terminalRecords.set(key, structuredClone(value)); return true; },
    deleteEntry: async key => { terminalDeleteAttempts += 1; return terminalDeleteAttempts > 1 ? terminalRecords.delete(key) : false; },
    now: (() => { let value = 5000; return () => ++value; })(), transactionId: () => 'terminal-gc',
});
const terminalEntry = await terminalJournal.begin({
    scopeId: 'chat', affectedScopeIds: [], baseStoreRevision: 0, previous: valid, candidate: valid,
});
await terminalJournal.complete(terminalEntry, 'rejected');
assert.equal(terminalRecords.size, 1, 'terminal 删除暂态失败时必须保留已完成记录而不是伪装清理成功');
const terminalRestart = createTodayTrendJournal({
    listKeys: async () => [...terminalRecords.keys()],
    readEntry: async key => ({ ok: true, value: structuredClone(terminalRecords.get(key)) }),
    deleteEntry: async key => { terminalDeleteAttempts += 1; return terminalRecords.delete(key); },
});
assert.deepEqual(await terminalRestart.ready(), [], '遗留 terminal journal 启动时不得重新进入开放事务');
assert.equal(terminalRecords.size, 0, '遗留 terminal journal 必须在后续启动时再次尝试回收');


let transientLists = 0;
const transientJournal = createTodayTrendJournal({
    listKeys: async () => {
        transientLists += 1;
        if (transientLists === 1) throw Object.assign(new Error('temporary IDB failure'), { code: 'TT_JOURNAL_UNAVAILABLE' });
        return [];
    },
});
const transientRuntime = {};
const transientCommitter = createTodayTrendCommitter({ runtime: transientRuntime, journal: transientJournal });
await assert.rejects(() => transientCommitter.ready(), error => error?.code === 'TT_JOURNAL_UNAVAILABLE',
    '首次暂态 journal 读取失败必须向调用方报告');
await transientCommitter.ready();
assert.equal(transientLists, 2, '暂态恢复失败后同一 committer 必须允许受控重试');
assert.equal(transientRuntime.recoveryError, undefined, '恢复重试成功后必须清除旧 recoveryError');


await sagaAuthority.release({ readV2: true, serveV2: false });
sagaAuthority.close();

let blockedGenerateCalls = 0;
const blockedScheduler = createTodayTrendScheduler({
    controller: { generate: async () => { blockedGenerateCalls += 1; return { scope: valid.scopes.chat }; } },
    committer: { commitStore: async () => valid, invalidateCommits() {}, ready: async () => [], isBlocked: () => true },
    getStore: async () => valid, getStorageId: () => 'chat', getChat: () => [],
});
await assert.rejects(() => blockedScheduler.manual({ storageId: 'chat', floor: 1 }), error => error?.code === 'TT_TRANSACTION_BLOCKED',
    'blocked journal 必须在昂贵生成前拒绝 scheduler');
assert.equal(blockedGenerateCalls, 0, 'blocked scheduler 不得调用生成控制器');

const originalInjectionWindow = globalThis.window;
let preflightPromptWrites = 0;
globalThis.window = {};
try {
    const injectionRuntime = { injectionEpoch: 0, trackedExtensionPromptKeys: new Set(), todayTrend: { store: valid } };
    const injectionController = createPhoneInjectionController({
        state: { isGroupChat: false, currentPersona: 'chat' }, runtime: injectionRuntime,
        deps: {}, getStorageId: () => 'chat', getUserPersona: () => ({ name: '用户' }),
        getCtx: () => ({ characterId: 'character', characters: { character: { name: '小明' } }, setExtensionPrompt: () => { preflightPromptWrites += 1; } }),
    });
    const preflight = await injectionController.prepareBidirectionalInjection(valid);
    assert.ok(Array.isArray(preflight.prompts), '纯注入预检必须返回可验证 prompt plan');
    assert.equal(preflightPromptWrites, 0, '纯注入预检绝不能调用 setExtensionPrompt');
} finally {
    if (originalInjectionWindow === undefined) delete globalThis.window;
    else globalThis.window = originalInjectionWindow;
}

let committed = structuredClone(valid);
const committer = createTodayTrendCommitter({
    load: async () => committed,
    save: async value => { committed = structuredClone(value); return committed; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
const committedStore = await committer.commitStore(store => ({ ...store, scopes: { ...store.scopes, branch: copyTodayTrendScope(store.scopes.chat, 'branch') } }));
assert.equal(committedStore.scopes.branch.storageId, 'branch', '事务提交必须保存归一化候选数据');
const beforeInjectionFailure = structuredClone(committed);
const compensationRefreshes = [];
const compensationRuntime = {};
const compensatingCommitter = createTodayTrendCommitter({
    runtime: compensationRuntime,
    load: async () => committed,
    save: async value => { committed = structuredClone(value); return committed; },
    refreshInjection: async store => {
        compensationRefreshes.push(structuredClone(store));
        return compensationRefreshes.length === 1
            ? { failedWrites: 1, failedKeys: [] }
            : { failedWrites: 0, failedKeys: [] };
    },
});
await assert.rejects(() => compensatingCommitter.commitStore(store => ({ ...store, scopes: {} })), /今日风向注入刷新失败/);
assert.equal(compensationRefreshes.length, 2, '候选注入失败后必须尝试补偿旧 prompt');
assert.deepEqual(compensationRefreshes[0].scopes, {}, '首次刷新必须使用候选快照');
assert.deepEqual(compensationRefreshes[1], beforeInjectionFailure, '补偿刷新必须恢复提交前的完整快照');
assert.deepEqual(committed, beforeInjectionFailure, '旧 prompt 补偿成功后持久化快照必须恢复');
assert.deepEqual(compensationRuntime.store, beforeInjectionFailure, '旧 prompt 补偿成功后运行时快照必须恢复');
const failingCommitter = createTodayTrendCommitter({
    load: async () => committed,
    save: async value => { committed = structuredClone(value); return committed; },
    refreshInjection: async () => ({ failedWrites: 1, failedKeys: [] }),
});
await assert.rejects(() => failingCommitter.commitStore(store => ({ ...store, scopes: {} })), /今日风向注入刷新失败/);
assert.deepEqual(committed, beforeInjectionFailure, '注入失败必须补偿为提交前的持久化快照');

let fencedStore = structuredClone(valid);
let fencedRevision = 1;
let releaseFailedRefresh;
const failedRefreshEntered = new Promise(resolve => { releaseFailedRefresh = resolve; });
let continueFailedRefresh;
const failedRefreshBlocked = new Promise(resolve => { continueFailedRefresh = resolve; });
const fencedCommitter = createTodayTrendCommitter({
    load: async () => structuredClone(fencedStore),
    save: async (value, options = {}) => {
        if (options.expectedStoreRevision !== undefined && options.expectedStoreRevision !== fencedRevision) {
            const error = new Error('revision changed');
            error.code = 'TT_STORE_REVISION_CONFLICT';
            throw error;
        }
        fencedStore = structuredClone(value);
        fencedRevision += 1;
        return options.returnReceipt ? { store: structuredClone(fencedStore), storeRevision: fencedRevision } : structuredClone(fencedStore);
    },
    refreshInjection: async () => {
        releaseFailedRefresh();
        await failedRefreshBlocked;
        return { failedWrites: 1, failedKeys: [] };
    },
});
const fencedCommit = fencedCommitter.commitStore(store => ({ ...store, scopes: {} }));
await failedRefreshEntered;
const laterSuccessfulStore = structuredClone(valid);
laterSuccessfulStore.presets.preset.name = '稍后成功提交';
fencedStore = laterSuccessfulStore;
fencedRevision += 1;
continueFailedRefresh();
await assert.rejects(() => fencedCommit, error => error?.rollbackError?.code === 'TT_STORE_REVISION_CONFLICT',
    '候选提交后的 revision 已变化时，迟到补偿必须报告明确冲突而不是覆盖新数据');
assert.deepEqual(fencedStore, laterSuccessfulStore, '迟到补偿冲突后必须保留稍后成功提交的数据');

let startupReadyCalls = 0;
let releaseStartupRecovery;
let startupRawLoads = 0;
let startupBlocked = false;
let blockedInitializationCalls = 0;
let blockedRuleRegenerationCalls = 0;
let startupReadyPromise = null;
const startupDeps = {
    runtime: {}, getStorageId: () => 'chat',
    getCtx: () => ({ characterId: 'character', characters: { character: { avatar: 'character', name: '小明' } }, chat: [] }),
    getLastMessageId: () => 1,
    callAI: async () => { throw new Error('恢复屏障测试不应调用真实 AI'); },
    loadTodayTrendStore: async () => { startupRawLoads += 1; return structuredClone(valid); },
    saveTodayTrendStore: async value => value,
    createTodayTrendCommitter: () => ({
        ready: () => startupReadyPromise || (startupReadyPromise = new Promise(resolve => {
            startupReadyCalls += 1;
            releaseStartupRecovery = resolve;
        })),
        isBlocked: () => startupBlocked,
        commitStore: async () => { throw new Error('恢复屏障测试不应进入提交'); },
        invalidateCommits() {},
    }),
    createTodayTrendGenerationController: () => ({
        generate: async () => ({ scope: structuredClone(valid.scopes.chat) }),
        initialize: async () => { blockedInitializationCalls += 1; return { store: structuredClone(valid) }; },
        regenerateRule: async () => { blockedRuleRegenerationCalls += 1; return '不应生成'; },
    }),
};
installTodayTrend({}, startupDeps);
await Promise.resolve();
assert.equal(startupReadyCalls, 1, '安装 Today Trend 时必须立即启动一次恢复，而不是等待下一次写入或生成');
const startupRead = startupDeps.getTodayTrendStore();
await Promise.resolve();
assert.equal(startupRawLoads, 0, '启动恢复完成前不得向 UI 暴露持久化 store');
releaseStartupRecovery([]);
await startupRead;
assert.equal(startupRawLoads, 1, '启动恢复完成后读取链才能加载 store');
startupBlocked = true;
await assert.rejects(() => startupDeps.initializeTodayTrend(), error => error?.code === 'TT_TRANSACTION_BLOCKED');
await assert.rejects(() => startupDeps.regenerateTodayTrendRule('world'), error => error?.code === 'TT_TRANSACTION_BLOCKED');
assert.equal(blockedInitializationCalls, 0, 'blocked journal 必须在初始化 AI 调用前拒绝');
assert.equal(blockedRuleRegenerationCalls, 0, 'blocked journal 必须在规则重生成 AI 调用前拒绝');

let installedStore = structuredClone(valid);
installedStore.presets.free = { ...structuredClone(installedStore.presets.preset), id: 'free', name: '未绑定预设' };
installedStore.scopes.other = { ...structuredClone(installedStore.scopes.chat), storageId: 'other' };
let installedChat = [{ mes: '内部助手消息' }, { mes: '内部助手消息二' }, { mes: '内部助手消息三' }];
let installedHostFloor = 3402;
let installedHostFloorError = null;
let resolveInstalledInitialization;
const installedDeps = {
    runtime: {}, getStorageId: () => 'chat', getCtx: () => ({ characterId: 'character', characters: { character: { avatar: 'character', name: '小明' } }, chat: installedChat }),
    getLastMessageId: () => {
        if (installedHostFloorError) throw installedHostFloorError;
        return installedHostFloor;
    },
    callAI: async () => { throw new Error('安装层竞争测试不应调用真实 AI'); },
    loadTodayTrendStore: async () => structuredClone(installedStore),
    saveTodayTrendStore: async value => { installedStore = structuredClone(value); return installedStore; },
    applyBidirectionalInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
    createTodayTrendGenerationController: () => ({
        generate: async () => ({ scope: structuredClone(installedStore.scopes.chat) }),
        regenerateRule: async () => '不应调用',
        initialize: async () => new Promise(resolve => { resolveInstalledInitialization = resolve; }),
    }),
};
installTodayTrend({}, installedDeps);
assert.equal(installedDeps.getTodayTrendCurrentFloor(), 3402, '安装层必须公开酒馆原生 getLastMessageId 楼层');
installedHostFloor = null;
assert.equal(installedDeps.getTodayTrendCurrentFloor(), null, '宿主楼层返回 null 时不得用内部 assistant 统计冒充真实楼层');
installedHostFloor = '   ';
assert.equal(installedDeps.getTodayTrendCurrentFloor(), null, '宿主楼层返回空白字符串时不得误判为 0 楼或内部统计');
installedHostFloorError = new Error('宿主楼层读取失败');
assert.equal(installedDeps.getTodayTrendCurrentFloor(), null, '宿主楼层读取抛错时必须报告不可用而不是伪造楼层');
installedHostFloorError = null;
installedHostFloor = 3402;
await assert.rejects(() => installedDeps.deleteTodayTrendPreset('preset'), /仍被角色资料使用/, '被当前或其他角色资料引用的预设不得删除');
assert.ok(installedStore.presets.preset, '删除被引用预设失败后必须保持原预设');
await installedDeps.deleteTodayTrendPreset('free');
assert.equal(installedStore.presets.free, undefined, '未被引用的预设必须允许删除');
await installedDeps.saveTodayTrendRule('world', '手工保存的规则', 'preset', 1);
assert.equal(installedStore.presets.preset.revision, 2, '手工规则保存必须递增预设修订号');
assert.equal(installedStore.presets.preset.moduleRules.world, '手工保存的规则');
await assert.rejects(() => installedDeps.saveTodayTrendRule('world', '迟到旧规则', 'preset', 1), /预设已变化/,
    '旧 revision 的规则保存不得覆盖新规则');
assert.equal(installedStore.presets.preset.moduleRules.world, '手工保存的规则', '被拒绝的旧规则保存不得改写已提交规则');
const pendingReinitialize = installedDeps.initializeTodayTrend({ presetId: 'preset', worldBookNames: ['厨房'], includeExistingChat: true });
await Promise.resolve();
let initializationCanonical = structuredClone(migratedValidV2);
let initializationGenerateCalls = 0;
const initializationCanonicalDeps = {
    runtime: {}, getStorageId: () => 'chat', getLastMessageId: () => 2,
    getCtx: () => ({ characterId: 'character', characters: { character: { avatar: 'character', name: '小明' } }, chat: [] }),
    callAI: async () => { throw new Error('canonical 初始化测试不应调用 transport'); },
    loadTodayTrendStore: async () => buildReadOnlyShadow(initializationCanonical), saveTodayTrendStore: async value => value,
    createTodayTrendGenerationController: () => ({
        initialize: async () => ({ store: structuredClone(valid) }),
        generate: async () => { initializationGenerateCalls += 1; throw new Error('零历史不应进入批处理'); },
        regenerateRule: async () => '不应调用',
    }),
    createTodayTrendCommitter: () => ({
        ready: async () => [], isBlocked: () => false, supportsCanonical: true, invalidateCommits() {},
        loadCanonical: async () => structuredClone(initializationCanonical),
        commitStore: async (mutate, _task, options) => {
            assert.equal(options.canonical, true, '初始化 replacement 必须走 canonical commit');
            const previous = structuredClone(initializationCanonical);
            const candidate = await mutate(structuredClone(previous));
            initializationCanonical = validateTodayTrendV2Transition(previous, candidate);
            initializationCanonical.globalEnvelope.revision += 1;
            initializationCanonical.globalEnvelope.payload.scopes.chat.revision += 1;
            return buildReadOnlyShadow(initializationCanonical);
        },
    }),
};
installTodayTrend({}, initializationCanonicalDeps);
await initializationCanonicalDeps.initializeTodayTrend({ presetId: 'preset', worldBookNames: ['厨房'], backfillExistingChat: true });
const initializationCanonicalPayload = initializationCanonical.globalEnvelope.payload.scopes.chat.payload;
assert.deepEqual(initializationCanonicalPayload.generationSnapshots.map(snapshot => snapshot.assistantCount), [0],
    '零 assistant 历史的 canonical 初始化必须只提交 full@0 基线');
assert.equal(initializationCanonicalPayload.generationSnapshots[0].restoreCapability, 'full',
    '零 assistant 历史的 canonical 初始化基线必须可完整回退');
assert.equal(initializationGenerateCalls, 0, '零 assistant 历史即使开启回填也不得调用 scheduler.manual');
let backfillCanonical = structuredClone(migratedValidV2);
let backfillGenerateCalls = 0;
let backfillGenerateOptions = null;
const backfillFailureDeps = {
    runtime: {}, getStorageId: () => 'chat', getLastMessageId: () => 2,
    getCtx: () => ({ characterId: 'character', characters: { character: { avatar: 'character', name: '小明' } }, chat: [{ mes: 'AI 一' }, { mes: 'AI 二' }] }),
    callAI: async () => { throw new Error('回填失败测试不应调用 transport'); },
    loadTodayTrendStore: async () => buildReadOnlyShadow(backfillCanonical), saveTodayTrendStore: async value => value,
    createTodayTrendGenerationController: () => ({
        initialize: async () => ({ store: structuredClone(valid) }),
        generate: async options => {
            backfillGenerateCalls += 1;
            backfillGenerateOptions = options;
            throw Object.assign(new Error('模拟历史生成失败'), { code: 'TT_HISTORY_TEST_FAILED' });
        },
        regenerateRule: async () => '不应调用',
    }),
    createTodayTrendCommitter: () => ({
        ready: async () => [], isBlocked: () => false, supportsCanonical: true, invalidateCommits() {},
        loadCanonical: async () => structuredClone(backfillCanonical),
        commitStore: async (mutate, _task, options) => {
            const previous = structuredClone(backfillCanonical);
            const candidate = await mutate(structuredClone(previous));
            backfillCanonical = validateTodayTrendV2Transition(previous, candidate);
            backfillCanonical.globalEnvelope.revision += 1;
            backfillCanonical.globalEnvelope.payload.scopes.chat.revision += 1;
            assert.equal(options.canonical, true, '回填前初始化与后续批处理必须保持 canonical 写链');
            return buildReadOnlyShadow(backfillCanonical);
        },
    }),
};
installTodayTrend({}, backfillFailureDeps);
await backfillFailureDeps.initializeTodayTrend({ presetId: 'preset', worldBookNames: ['厨房'], backfillExistingChat: true,
    recentAssistantCount: 1, mergeAssistantCount: 1 });
assert.equal(backfillGenerateCalls, 0, '普通初始化即使保存回填配置也不得隐式启动 batchEnabled 路径');
backfillCanonical = structuredClone(migratedValidV2);
await assert.rejects(() => backfillFailureDeps.initializeTodayTrend({ presetId: 'preset', worldBookNames: ['厨房'], backfillExistingChat: true,
    recentAssistantCount: 1, mergeAssistantCount: 1, runBackfill: true }),
    /模拟历史生成失败/,
    '用户明确选择手动批量更新后，历史批处理失败必须可观察并保留原始错误');
assert.equal(backfillGenerateCalls, 1, '存在 assistant 历史且明确选择手动批量更新时必须启动 batchEnabled 路径');
assert.equal(backfillGenerateOptions?.assistantCount, 2,
 '初始化回填的批次终点必须保留当前 assistant 总数');
assert.deepEqual(backfillGenerateOptions?.historyBatch, [{ role: 'assistant', content: 'AI 二' }],
    '初始化回填必须将用户选择的 recentAssistantCount 传入 scheduler.manual 并仅生成尾部窗口');
assert.deepEqual(backfillCanonical.globalEnvelope.payload.scopes.chat.payload.operation.batchDraft,
    { enabled: true, recentAssistantCount: 1, mergeAssistantCount: 1 },
    '初始化 canonical 提交必须持久化与历史回填完全相同的批处理参数');
assert.deepEqual(backfillCanonical.globalEnvelope.payload.scopes.chat.payload.generationSnapshots.map(snapshot => snapshot.assistantCount), [0],
    '历史回填失败不得回滚或破坏已提交的 canonical full@0 基线');
await assert.rejects(() => backfillFailureDeps.initializeTodayTrend({ presetId: 'preset', worldBookNames: ['厨房'], backfillExistingChat: true,
    recentAssistantCount: 3, mergeAssistantCount: 1 }), error => error?.code === 'TT_HISTORY_WINDOW_INVALID',
    '初始化必须以提交时 assistantCount 拒绝超出实时聊天范围的 recentAssistantCount');
await assert.rejects(() => backfillFailureDeps.initializeTodayTrend({ presetId: 'preset', worldBookNames: ['厨房'], backfillExistingChat: true,
    recentAssistantCount: 1, mergeAssistantCount: 2 }), error => error?.code === 'TT_HISTORY_WINDOW_INVALID',
    '初始化必须拒绝大于最近处理层数的 mergeAssistantCount');
assert.equal(backfillGenerateCalls, 1, '非法初始化回填窗口不得进入调度器');
backfillCanonical = structuredClone(migratedValidV2);
backfillGenerateOptions = null;
await backfillFailureDeps.initializeTodayTrend({ presetId: 'preset', worldBookNames: ['厨房'], backfillExistingChat: false,
    recentAssistantCount: 2, mergeAssistantCount: 1 });
assert.equal(backfillGenerateCalls, 1, '初始化历史回填开关关闭时不得进入批处理');
assert.equal(backfillGenerateOptions, null, '初始化历史回填开关关闭时不得向 scheduler.manual 传递参数');
assert.equal(Object.hasOwn(backfillCanonical.globalEnvelope.payload.scopes.chat.payload.operation, 'batchDraft'), false,
    '初始化历史回填开关关闭时不得持久化本次批处理草稿');

await installedDeps.saveTodayTrendRule('world', '初始化期间的新规则', 'preset', 2);
const delayedInitializationStore = structuredClone(installedStore);
delayedInitializationStore.presets.preset.moduleRules.world = '迟到初始化规则';
delayedInitializationStore.scopes.chat.world.items[0].summary = '迟到初始化内容';
resolveInstalledInitialization({ store: delayedInitializationStore });
await assert.rejects(pendingReinitialize, /预设已变化，初始化结果已丢弃/,
    '重新初始化期间预设被修改时，迟到结果必须被丢弃');
assert.equal(installedStore.presets.preset.moduleRules.world, '初始化期间的新规则', '迟到初始化不得覆盖新规则');

let collectedOptions = null;
const collectedContext = await gatherTodayTrendContext({
    getCtx: () => ({}), storageId: 'init-chat', characterId: 'role-1', characterName: '小明',
    worldBookNames: ['厨房'], includeExistingChat: true, userRequirements: '保持综艺竞赛氛围',
    collectContext: async (_getCtx, options) => { collectedOptions = options; return { userName: '助手', userDesc: '参赛者', cardDesc: '厨艺综艺选手', cardPersonality: '冷静',
        cardScenario: '决赛临近', cardFirstMes: '开始吧', cardMesExample: '专注备菜', worldBookText: '厨房规则与节目组',
        mainChatText: '助手：准备晚餐服务', latestChatText: '小明：检查食材' }; },
});
assert.deepEqual(collectedContext.source.worldBookNames, ['厨房'], '初始化上下文必须保存选中的世界书名称');
assert.equal(collectedOptions.module, 'todayTrend', '今日风向必须使用独立世界书读取权限');
assert.deepEqual(collectedOptions.worldBookNames, ['厨房'], '初始化必须只读取用户选中的世界书');
assert.equal(collectedOptions.worldBookActivationMode, 'chat', '正文关联模式必须保留聊天关键词激活');
assert.match(collectedContext.mainChatText, /晚餐服务/, '启用已有正文时必须保留主线正文');
const initializationPrompts = buildTodayTrendInitializationEnvelope({ context: collectedContext });
assert.match(initializationPrompts.systemPrompt, /顶层只能有 preset 和 scope/, '初始化提示词必须锁定单一返回协议');
assert.ok(initializationPrompts.systemPrompt.includes(titleNamingGuide), '初始化提示词必须注入共享标题命名指南');
assert.match(initializationPrompts.systemPrompt, /不得输出 icon、iconKey、topic、category/,'初始化提示词必须禁止输出展示实现字段');
assert.match(initializationPrompts.systemPrompt, /A\.parentId 等于 B\.id[\s\S]*保留 parentId 并删除对应外部关联[\s\S]*只针对直接父子/, '初始化提示词必须声明直接父子与外部关联互斥');
assert.match(initializationPrompts.systemPrompt, /relatedEventIds 只能引用本次 dynamics 完整 active 与 archived 集合中其他事件的精确 ID/, '初始化提示词必须限制关联到同次 dynamics 的确事件 ID');
assert.match(initializationPrompts.systemPrompt, /禁止引用自身、标题、自然语言名称、已不存在的旧 ID 或猜测 ID/, '初始化提示词必须禁止 self、标题、自然语言、旧 ID 和猜测 ID 关联');
assert.match(initializationPrompts.systemPrompt, /没有合法关联时必须输出 \[\]/, '初始化提示词必须要求无合法关联时输出空数组');
assert.match(initializationPrompts.userPrompt, /world_book_data/, '初始化提示词必须传递世界书内容');
assert.match(initializationPrompts.userPrompt, /main_chat_data/, '初始化提示词必须传递已有正文');
assert.deepEqual(initializationPrompts, buildCanonicalTodayTrendInitializationEnvelope({ context: collectedContext }),
    '兼容 facade 必须逐字符委托今日风向初始化提示词实现');
let independentCollectedOptions = null;
const independentCollectedContext = await gatherTodayTrendContext({
    getCtx: () => ({}), storageId: 'independent-chat', characterId: 'role-1', characterName: '小明',
    worldBookNames: ['居民设定'], includeExistingChat: false,
    collectContext: async (_getCtx, options) => {
        independentCollectedOptions = options;
        return { userName: '助手', userDesc: '观察者', cardDesc: '普通居民', cardPersonality: '谨慎',
            cardScenario: '社区日常', cardFirstMes: '早上好', cardMesExample: '整理店铺', worldBookText: '居民与社区规则',
            mainChatText: '这段正文不应进入独立模式', latestChatText: '这条最新正文也不应进入独立模式' };
    },
});
assert.equal(independentCollectedOptions.module, 'todayTrend', '独立模式仍必须使用今日风向世界书权限');
assert.deepEqual(independentCollectedOptions.worldBookNames, ['居民设定'], '独立模式必须只读取用户选中的世界书');
assert.equal(independentCollectedOptions.worldBookActivationMode, 'selected', '关闭正文后必须切换到 selected 世界书激活模式');
assert.equal(independentCollectedContext.mainChatText, '', '独立模式上下文不得保留主线正文');
assert.equal(independentCollectedContext.latestChatText, '', '独立模式上下文不得保留最新正文');
const independentInitializationPrompts = buildTodayTrendInitializationEnvelope({ context: independentCollectedContext });
assert.doesNotMatch(independentInitializationPrompts.userPrompt, /main_chat_data/, '独立初始化 prompt 不得包含正文数据区块');
assert.match(independentInitializationPrompts.userPrompt, /world_book_data/, '独立初始化 prompt 必须保留世界书数据区块');
assert.match(independentInitializationPrompts.userPrompt, /generation_mode/, '独立初始化 prompt 必须声明生成模式');
assert.match(independentInitializationPrompts.userPrompt, /逻辑时间刻度/, '独立初始化 prompt 必须把楼层定义为逻辑时间刻度');
assert.match(independentInitializationPrompts.userPrompt, /NPC 个体、群体或组织/, '独立初始化 prompt 必须使用通用 NPC 群像语义');
assert.match(independentInitializationPrompts.userPrompt, /不必与目标角色直接互动/, '独立初始化 prompt 必须允许 NPC 线独立于目标角色');
const independentGenerationPrompts = buildTodayTrendGenerationEnvelope({
    context: independentCollectedContext, preset: valid.presets.preset, scope: valid.scopes.chat, assistantCount: 12,
});
assert.ok(independentGenerationPrompts.systemPrompt.includes(titleNamingGuide), '增量提示词必须注入同源标题命名指南');
assert.doesNotMatch(independentGenerationPrompts.userPrompt, /main_chat_data/, '独立增量 prompt 不得包含正文数据区块');
assert.match(independentGenerationPrompts.userPrompt, /world_book_data/, '独立增量 prompt 必须保留世界书数据区块');
assert.match(independentGenerationPrompts.userPrompt, /NPC 个体、群体或组织生活线/, '独立增量 prompt 必须允许通用 NPC 生活线持续推进');
assert.match(independentGenerationPrompts.userPrompt, /既有 active 事件优先连续推进/, '独立增量 prompt 必须优先连续推进既有 active 事件');
assert.match(independentGenerationPrompts.userPrompt, /保留其 id、origin、participants 与已有阶段历史/, '独立增量 prompt 必须稳定保留 NPC 事件基础资料');
assert.match(independentGenerationPrompts.userPrompt, /没有合理进展时模块输出 `null`/, '独立增量 prompt 必须允许无进展时不生成内容');

const generatedInitialization = fixture();
generatedInitialization.presets.preset.id = 'ai-preset';
generatedInitialization.scopes.chat.storageId = 'ai-chat';
generatedInitialization.scopes.chat.characterId = 'ai-role';
generatedInitialization.scopes.chat.characterName = 'AI 角色';
generatedInitialization.scopes.chat.presetId = 'ai-preset';
const initializationSignal = new AbortController().signal;
const ruleRegenerationSignal = new AbortController().signal;
let initializationCalls = 0;
const controller = createTodayTrendGenerationController({
    getCtx: () => ({}), now: () => 100,
    gather: async input => ({ ...collectedContext, storageId: input.storageId, characterId: input.characterId, characterName: input.characterName }),
    callAI: async (systemPrompt, userPrompt, options) => {
        if (systemPrompt.includes('重写虚构角色扮演世界的单个')) {
            assert.deepEqual({ systemPrompt, userPrompt }, buildCanonicalTodayTrendRuleRegenerationEnvelope({
                context: collectedContext, rule: 'dynamics-rumor', currentRule: valid.presets.preset.dynamicsRules.rumor,
            }), '规则重生成必须委托今日风向 prompt domain');
            assert.equal(options.isolated, true, '规则重生成必须维持独立 AI transport');
            assert.equal(options.signal, ruleRegenerationSignal, '规则重生成必须传递调用方取消信号');
            return JSON.stringify({ rule: '规则重写' });
        }
        initializationCalls += 1;
        assert.equal(options.isolated, true, '初始化必须维持独立 AI transport');
        assert.equal(options.signal, initializationSignal, '初始化必须传递调用方取消信号');
        return JSON.stringify({ preset: generatedInitialization.presets.preset, scope: generatedInitialization.scopes.chat });
    },
});
const initialized = await controller.initialize({ storageId: 'init-chat', characterId: 'role-1', characterName: '小明', signal: initializationSignal });
assert.equal(initializationCalls, 1, '一次初始化必须只调用一次 AI');
assert.equal(initialized.store.scopes['init-chat'].presetId, 'init-chat:preset', '初始化必须固定 scope 到受控预设 ID');
assert.equal(initialized.store.presets['init-chat:preset'].source.userRequirements, '保持综艺竞赛氛围', '初始化必须保留用户补充要求');
assert.equal(initialized.store.scopes['init-chat'].operation.enabled, false, '初始化结果不得绕过默认手动运行设置');
const overlappingInitialization = fixture();
overlappingInitialization.scopes.chat.factions[0].relatedFactionIds = ['station'];
overlappingInitialization.scopes.chat.factions[1].relatedFactionIds = ['red'];
const cleanedInitialization = await createTodayTrendGenerationController({
    getCtx: () => ({}), now: () => 101,
    gather: async input => ({ ...collectedContext, storageId: input.storageId, characterId: input.characterId, characterName: input.characterName }),
    callAI: async () => JSON.stringify({ preset: overlappingInitialization.presets.preset, scope: overlappingInitialization.scopes.chat }),
}).initialize({ storageId: 'overlap-chat', characterId: 'role-2', characterName: '阿红' });
assert.deepEqual(cleanedInitialization.store.scopes['overlap-chat'].factions[0].relatedFactionIds, [], '初始化必须清理父势力指向直接子势力的重复外部关联');
assert.deepEqual(cleanedInitialization.store.scopes['overlap-chat'].factions[1].relatedFactionIds, [], '初始化必须清理子势力指向直接父势力的重复外部关联');
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ preset: {}, scope: {} }),
}).initialize({ storageId: 'init-chat', characterId: 'role-1', characterName: '小明' }), /今日风向初始化失败/,
'无效 AI 输出必须整单拒绝，不能留下半预设');

const generationPrompts = buildTodayTrendGenerationEnvelope({
    context: collectedContext, preset: valid.presets.preset, scope: valid.scopes.chat, assistantCount: 8,
});
assert.deepEqual(generationPrompts, buildCanonicalTodayTrendGenerationEnvelope({
    context: collectedContext, preset: valid.presets.preset, scope: valid.scopes.chat, assistantCount: 8,
}), '兼容 facade 必须逐字符委托今日风向增量提示词实现');
assert.deepEqual(buildTodayTrendRuleRegenerationEnvelope({ context: collectedContext, rule: 'dynamics-rumor', currentRule: valid.presets.preset.dynamicsRules.rumor }),
    buildCanonicalTodayTrendRuleRegenerationEnvelope({ context: collectedContext, rule: 'dynamics-rumor', currentRule: valid.presets.preset.dynamicsRules.rumor }),
    '兼容 facade 必须逐字符委托今日风向规则重生成提示词实现');
const regeneratedRule = await controller.regenerateRule({ scope: valid.scopes.chat, preset: valid.presets.preset, rule: 'dynamics-rumor', signal: ruleRegenerationSignal });
assert.equal(regeneratedRule, '规则重写', '规则重生成必须只返回校验后的规则文本');
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ rule: '规则重写', extra: true }),
}).regenerateRule({ scope: valid.scopes.chat, preset: valid.presets.preset, rule: 'world' }), /今日风向规则重生成失败/,
'规则重生成不得接受协议外字段');
assert.match(generationPrompts.systemPrompt, /顶层必须且只能有 world、reputation、factions、dynamics、history 五个键/, '后续生成必须锁定五键协议');
assert.match(generationPrompts.systemPrompt, /键集合必须严格等于 eventId、stages、daySummaries、periodSummaries/, 'history event 必须明确禁止混入 dynamics 字段');
assert.match(generationPrompts.systemPrompt, /stages 必须是非空字符串数组[\s\S]*禁止输出 id、kind、text、time、timeLabel 或任何对象/,
    '事件追踪生成提示词必须区分 v2 输入投影与 v1 字符串 stages 输出契约');

assert.match(generationPrompts.systemPrompt, /daySummaries 的判定必须逐 event 独立执行/, '封日摘要判定不得受其他 event 的开放日期影响');
assert.match(generationPrompts.systemPrompt, /每个满足条件的 event 都必须独立提供该摘要，不受本轮其他 event 数量限制/,
    '封日摘要提示词不得引入跨事件数量配额');
assert.match(generationPrompts.systemPrompt, /当前没有开放 live-stage、可信 story_date 缺失或未前进时，必须输出 daySummaries:\[\]，即使该 event 本轮追加了 stages 也禁止生成 daySummary/,
    '无开放 live-stage 的 event 即使本轮追加阶段也必须明确禁止伪造封日摘要');
assert.match(generationPrompts.systemPrompt, /relatedEventIds 只能引用本次 dynamics 完整 active 与 archived 集合中其他事件的精确 ID/,
    '增量提示词必须限制关联到同次 dynamics 的精确事件 ID');
assert.match(generationPrompts.systemPrompt, /禁止引用自身、标题、自然语言名称、已不存在的旧 ID 或猜测 ID/,
    '增量提示词必须禁止 self、标题、自然语言、旧 ID 和猜测 ID 关联');
assert.match(generationPrompts.systemPrompt, /没有合法关联时必须输出 \[\]/, '增量提示词必须要求无合法关联时输出空数组');
assert.match(generationPrompts.systemPrompt, /不允许新建 type 为 incident/, '未命中突发投骰时必须禁止新增事故');
assert.match(generationPrompts.systemPrompt, /地下线升级必须归档旧事件，再新建关联的 incident/, '生成提示词必须禁止原地改写地下线类型');
assert.match(generationPrompts.systemPrompt, /A\.parentId 等于 B\.id[\s\S]*保留 parentId 并删除对应外部关联[\s\S]*只针对直接父子/, '增量提示词必须声明直接父子与外部关联互斥');
assert.match(generationPrompts.userPrompt, /current_today_trend/, '后续生成必须带入已提交资料');
const targetedPrompts = buildTodayTrendGenerationEnvelope({
    context: collectedContext, preset: valid.presets.preset, scope: valid.scopes.chat, target: { module: 'world', itemId: 'world' },
});
assert.match(targetedPrompts.userPrompt, /本次仅更新 world 模块/, '单模块生成提示词必须限制模块边界');
assert.match(targetedPrompts.userPrompt, /不得新增、删除、重排或改写同模块其他项目/, '单项刷新提示词必须限制项目副作用');
const schemaPrompts = buildTodayTrendGenerationEnvelope({
    context: collectedContext, preset: valid.presets.preset, scope: valid.scopes.chat,
    target: { module: 'reputation', itemId: 'judge', mode: 'schema' },
});
assert.match(schemaPrompts.userPrompt, /保留其 status 与 evaluation/, '圈层结构刷新提示词必须锁定不可改写的关系字段');

const generationSignal = new AbortController().signal;
const updateController = createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async (_systemPrompt, _userPrompt, options) => {
        assert.equal(options.isolated, true, '普通增量必须维持独立 AI transport');
        assert.equal(options.signal, generationSignal, '普通增量必须传递调用方取消信号');
        return JSON.stringify({ world: { items: [{ id: 'world', name: '节目风向', summary: '晚餐服务已经开始' }] }, reputation: null, factions: null, dynamics: null });
    },
});
const generationPhases = [];
const updated = await updateController.generate({ scope: valid.scopes.chat, preset: valid.presets.preset, assistantCount: 8,
    onPhase: phase => generationPhases.push(phase), signal: generationSignal });
assert.equal(updated.scope.world.items[0].summary, '晚餐服务已经开始', '后续生成必须只替换发生变化的模块');
assert.deepEqual(generationPhases, ['generating', 'parsing'], '生成控制器必须暴露生成与解析阶段');
await assert.rejects(() => createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: { items: [{ id: 'world', name: '节目风向', summary: '有效', unexpected: true }], unexpected: true }, reputation: null, factions: null, dynamics: null }),
}).generate({ scope: valid.scopes.chat, preset: valid.presets.preset }), /包含额外字段/,
'后续生成嵌套对象出现协议外字段必须整次拒绝');
await assert.rejects(() => createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: { active: [...valid.scopes.chat.dynamics.active, { ...valid.scopes.chat.dynamics.active[0], id: 'incident', type: 'incident', title: '突发停电' }], archived: valid.scopes.chat.dynamics.archived } }),
}).generate({ scope: valid.scopes.chat, preset: valid.presets.preset }), /未允许生成突发事件/, '未命中投骰不得偷偷新增事故');
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: valid.scopes.chat.dynamics.active, archived: [{ ...valid.scopes.chat.dynamics.archived[0], finalResult: '被改写的归档结论' }],
    } }),
}).generate({ scope: valid.scopes.chat, preset: valid.presets.preset }), /已归档事件不能删除、改写或重新追踪/, '生成结果不得改写归档事件的任何字段');
const archiveDisabledScope = structuredClone(valid.scopes.chat);
archiveDisabledScope.dynamicsSettings.autoComplete = false;
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: [], archived: [...valid.scopes.chat.dynamics.archived, { ...valid.scopes.chat.dynamics.active[0], lifecycle: 'archived', outcome: 'resolved', finalResult: '模型擅自归档' }],
    } }),
}).generate({ scope: archiveDisabledScope, preset: valid.presets.preset }), /当前设置不允许自动归档事件/, '关闭自动判断完结时生成结果不得归档事件');
for (const [type, label] of [['rumor', '流言'], ['underground', '地下线']]) {
    const disabledScope = structuredClone(valid.scopes.chat);

    disabledScope.dynamicsSettings[type].enabled = false;

    await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
        callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
            active: [...valid.scopes.chat.dynamics.active, { ...valid.scopes.chat.dynamics.active[0], id: `new-${type}`, type, title: `新${label}` }], archived: valid.scopes.chat.dynamics.archived,
        } }),
    }).generate({ scope: disabledScope, preset: valid.presets.preset }), new RegExp(`本轮未允许生成${label}`), `关闭${label}开关时生成结果不得新增${label}`);
}

const fullUpdateController = createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({
        world: { items: [{ id: 'world', name: '节目风向', summary: '全量更新世界态势' }] },
        reputation: { circles: [{ id: 'judge', name: '评委团', scope: '现场评审', status: 'trust', evaluation: '全量更新个人风评' }] },
        factions: [{ ...valid.scopes.chat.factions[0], summary: '全量更新势力图谱' }],
        dynamics: {
            active: [{ ...valid.scopes.chat.dynamics.active[0], stageLabel: '服务中', latestStage: '全量更新事件阶段',
                stages: [...valid.scopes.chat.dynamics.active[0].stages, '全量更新事件阶段'] }],
            archived: valid.scopes.chat.dynamics.archived,
        },
    }),
});
const fullyUpdated = await fullUpdateController.generate({ scope: valid.scopes.chat, preset: valid.presets.preset, assistantCount: 8 });
assert.equal(fullyUpdated.scope.world.items[0].summary, '全量更新世界态势', '手动全量生成必须允许更新世界态势');
assert.equal(fullyUpdated.scope.reputation.circles[0].evaluation, '全量更新个人风评', '手动全量生成必须允许更新个人风评');
assert.equal(fullyUpdated.scope.factions[0].summary, '全量更新势力图谱', '手动全量生成必须允许更新势力图谱');
assert.equal(fullyUpdated.scope.dynamics.active[0].latestStage, '全量更新事件阶段', '手动全量生成必须允许更新事件追踪');
const factionReferenceScope = structuredClone(valid.scopes.chat);
factionReferenceScope.factions.push({
    id: 'rival', name: '蓝队', summary: '对手队伍', parentId: null, relatedFactionIds: ['red'], details: [],
    relation: { status: 'dislike', evaluation: '竞争激烈' },
});
const cleanedFactionReferences = await createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: factionReferenceScope.factions.map(faction =>
        faction.id === 'red' ? { ...faction, relatedFactionIds: ['missing-faction', 'station'] } : faction), dynamics: null }),
}).generate({ scope: valid.scopes.chat, preset: valid.presets.preset });
const cleanedRedFaction = cleanedFactionReferences.scope.factions.find(faction => faction.id === 'red');
const cleanedRivalFaction = cleanedFactionReferences.scope.factions.find(faction => faction.id === 'rival');
assert.deepEqual(cleanedRedFaction.relatedFactionIds, [],
    '生成链必须删除不存在和直接父子重叠的外部关联，避免将无效引用交给模型校验');
assert.deepEqual(cleanedRivalFaction.relatedFactionIds, ['red'],
    '生成链不得删除当前完整 factions 数组中的合法非父子外部关联');
await assert.rejects(() => createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: [{ ...valid.scopes.chat.dynamics.active[0], stages: [{ text: '错误的结构化阶段' }] }],
        archived: valid.scopes.chat.dynamics.archived,
    } }),
}).generate({ scope: valid.scopes.chat, preset: valid.presets.preset }), /事件追踪\.active\[0\]\.stages必须是非空字符串数组/,
'结构化 StageProjection 不得进入 v1 dynamics 输出契约或退化为泛化空阶段错误');

for (const stages of [null, [], [null], ['   ']]) {
    await assert.rejects(() => createTodayTrendGenerationController({
        getCtx: () => ({}), gather: async () => collectedContext,
        callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
            active: [{ ...valid.scopes.chat.dynamics.active[0], stages }],
            archived: valid.scopes.chat.dynamics.archived,
        } }),
    }).generate({ scope: valid.scopes.chat, preset: valid.presets.preset }), /事件追踪\.active\[0\]\.stages必须是非空字符串数组/,
    '无效事件阶段数组必须在提交前以字段路径拒绝');
}



const activeRumorGenerationScope = structuredClone(valid.scopes.chat);
activeRumorGenerationScope.dynamics.active.push({ ...activeRumorGenerationScope.dynamics.archived[0], id: 'generation-rumor', lifecycle: 'active', stageLabel: '流传中', outcome: null, finalResult: null, relatedEventIds: [] });
activeRumorGenerationScope.dynamics.archived = [];
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: valid.scopes.chat.dynamics.active, archived: [{ ...activeRumorGenerationScope.dynamics.active.at(-1), lifecycle: 'archived', outcome: 'resolved', finalResult: '错误归档' }],
    } }),
}).generate({ scope: activeRumorGenerationScope, preset: valid.presets.preset }), /事件类型与完结结果不匹配/, '生成链不得将流言以普通结果归档');
const multiDynamicsScope = structuredClone(valid.scopes.chat);
multiDynamicsScope.dynamics.active.push({ ...multiDynamicsScope.dynamics.active[0], id: 'second-service', title: '后厨协调', latestStage: '分配任务', stages: ['分配任务'] });
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: [{ ...multiDynamicsScope.dynamics.active[0], stageLabel: '服务中', latestStage: '开始出餐', stages: [...multiDynamicsScope.dynamics.active[0].stages, '开始出餐'] }, { ...multiDynamicsScope.dynamics.active[1], stageLabel: '协调中', latestStage: '临时换岗', stages: [...multiDynamicsScope.dynamics.active[1].stages, '临时换岗'] }],
        archived: multiDynamicsScope.dynamics.archived,
    } }),
}).generate({ scope: multiDynamicsScope, preset: valid.presets.preset, target: { module: 'dynamics', itemId: 'service' } }), /事件追踪单项刷新不得新增、删除、重排或改写其他事件/, '单事件推进不得改写其他动态');
const generatedRepeatedStageScope = structuredClone(valid.scopes.chat);
generatedRepeatedStageScope.dynamicsSettings.appendOnlyOnActualProgress = false;
const repeatedStageGeneration = await createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: [{ ...generatedRepeatedStageScope.dynamics.active[0], stageLabel: '等待中', stages: [...generatedRepeatedStageScope.dynamics.active[0].stages, generatedRepeatedStageScope.dynamics.active[0].latestStage] }], archived: generatedRepeatedStageScope.dynamics.archived,
    } }),
}).generate({ scope: generatedRepeatedStageScope, preset: valid.presets.preset });
assert.equal(repeatedStageGeneration.scope.dynamics.active[0].stages.length, 3, '关闭实际进展开关时生成链必须允许追加重复阶段');
const promotedByGenerationScope = structuredClone(undergroundScope);
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: [], archived: [...promotedByGenerationScope.dynamics.archived, { ...promotedByGenerationScope.dynamics.active[0], lifecycle: 'archived', outcome: 'absorbed', finalResult: '模型声称已承接' }],
    } }),
}).generate({ scope: promotedByGenerationScope, preset: valid.presets.preset }), /地下线升级必须归档旧事件并新建关联突发事件/, '生成链不得只归档地下线而缺少关联突发事件');
const targetedDynamicsUpdate = await createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: [{ ...multiDynamicsScope.dynamics.active[0], stageLabel: '服务中', latestStage: '开始出餐', stages: [...multiDynamicsScope.dynamics.active[0].stages, '开始出餐'] }, multiDynamicsScope.dynamics.active[1]], archived: multiDynamicsScope.dynamics.archived,
    } }),
}).generate({ scope: multiDynamicsScope, preset: valid.presets.preset, target: { module: 'dynamics', itemId: 'service' } });
assert.equal(targetedDynamicsUpdate.scope.dynamics.active[0].latestStage, '开始出餐', '单事件推进必须允许目标事件正常更新');
const strictProgressScope = structuredClone(valid.scopes.chat);
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: [{ ...strictProgressScope.dynamics.active[0], stageLabel: '等待中', stages: [...strictProgressScope.dynamics.active[0].stages, strictProgressScope.dynamics.active[0].latestStage] }], archived: strictProgressScope.dynamics.archived,
    } }),
}).generate({ scope: strictProgressScope, preset: valid.presets.preset }), /事件阶段追加后必须反映实际进展/, '开启实际进展开关时生成链不得伪造阶段追加');
const strictArchiveScope = structuredClone(valid.scopes.chat);
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: [], archived: [...strictArchiveScope.dynamics.archived, { ...strictArchiveScope.dynamics.active[0], lifecycle: 'archived', outcome: 'resolved', finalResult: '伪造完结', stages: [...strictArchiveScope.dynamics.active[0].stages, strictArchiveScope.dynamics.active[0].latestStage] }],
    } }),
}).generate({ scope: strictArchiveScope, preset: valid.presets.preset }), /事件阶段追加后必须反映实际进展/, '开启实际进展开关时归档不得追加重复阶段');
const archivedProgressScope = structuredClone(valid.scopes.chat);
const archivedProgress = await createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: null, dynamics: {
        active: [], archived: [...archivedProgressScope.dynamics.archived, { ...archivedProgressScope.dynamics.active[0], lifecycle: 'archived', stageLabel: '已收尾', latestStage: '服务完成', stages: [...archivedProgressScope.dynamics.active[0].stages, '服务完成'], outcome: 'resolved', finalResult: '服务顺利完成' }],
    } }),
}).generate({ scope: archivedProgressScope, preset: valid.presets.preset });
assert.equal(archivedProgress.scope.dynamics.archived.at(-1).latestStage, '服务完成', '归档时实际推进必须仍可保存阶段历史');
const savedRules = [];
const regeneratedRules = [];
const ruleEditorStates = [];
const generatedTargets = [];
const refreshedTargets = [];
const dispatcherRenders = [];
const dispatcherStatuses = [];
const dispatcherErrors = [];
let rejectRuleSave = false;
const dispatcherListeners = {};
const dispatcherContainer = {
    addEventListener: (type, listener) => { dispatcherListeners[type] = listener; },
    removeEventListener: () => {}, contains: () => true,
};
const dispatcher = createTodayTrendActionDispatcher({
    container: dispatcherContainer, getStorageId: () => 'chat', getStore: async () => valid,
    committer: { commitScope: async () => valid }, render: async view => { dispatcherRenders.push(view); },
    onGenerate: async module => { generatedTargets.push(module); },
    onRefresh: async (...target) => { refreshedTargets.push(target); },
    onSaveRule: async (...args) => { savedRules.push(args); if (rejectRuleSave) throw new Error('rule save blocked'); }, onRegenerateRule: async rule => { regeneratedRules.push(rule); },
    onRuleEditorStateChange: (...args) => { ruleEditorStates.push(args); },
    onStatus: message => dispatcherStatuses.push(message), onError: error => dispatcherErrors.push(error),
});
const generateAllButton = { disabled: false, dataset: { action: 'today-trend-generate-all' }, closest: () => generateAllButton };
dispatcherListeners.click({ target: generateAllButton });
await Promise.resolve();
assert.deepEqual(generatedTargets, [null], '顶栏手动更新必须分发到全量今日风向生成入口');
for (const [action, rule] of [['today-trend-edit-dynamics-rule', 'dynamics'], ['today-trend-edit-incident-rule', 'dynamics-incident'], ['today-trend-edit-rumor-rule', 'dynamics-rumor'], ['today-trend-edit-underground-rule', 'dynamics-underground']]) {
    const button = { disabled: false, dataset: { action }, closest: () => button };
    dispatcherListeners.click({ target: button });
    await Promise.resolve();
    assert.equal(dispatcher.state().editingRule, rule, '规则编辑动作必须记录当前规则');
    assert.equal(dispatcher.state().mode, 'rule-editor', '规则编辑动作必须切换到独立页面模式');
}
assert.deepEqual(ruleEditorStates.at(-1), [true, 'world'], '模块提示词入口必须通知控制器进入独立编辑页');
const regenerateButton = { disabled: false, dataset: { action: 'today-trend-regenerate-dynamics-rule' }, closest: () => regenerateButton };
dispatcherListeners.click({ target: regenerateButton });
await Promise.resolve();
assert.deepEqual(regeneratedRules, ['dynamics'], '规则重新生成必须分发到正确目标');
const cancelRuleButton = { disabled: false, dataset: { action: 'today-trend-cancel-rule-editor' }, closest: () => cancelRuleButton };
dispatcherListeners.click({ target: cancelRuleButton });
await Promise.resolve();
assert.equal(dispatcher.state().editingRule, null, '取消规则编辑必须清空编辑状态');
assert.equal(dispatcher.state().mode, 'content', '取消规则编辑必须恢复内容页模式');
assert.deepEqual(ruleEditorStates.at(-1), [false, 'world'], '取消规则编辑必须通知控制器恢复来源页面');
assert.ok(dispatcherRenders.length > 0, '规则动作必须触发重新渲染');
assert.deepEqual(savedRules, [], '规则编辑打开前不得错误提交提示词');
const originalFormData = globalThis.FormData;
globalThis.FormData = class {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values[name] ?? null; }
};
const worldRuleButton = { disabled: false, dataset: { action: 'today-trend-edit-world-rule', ruleReturn: 'world' }, closest: () => worldRuleButton };
dispatcherListeners.click({ target: worldRuleButton });
await Promise.resolve();
const ruleForm = {
    dataset: { todayTrendForm: 'rule-editor' }, values: { rule: 'world', text: '新的世界态势提示词' },
    matches: selector => selector === 'form[data-today-trend-form]',
};
dispatcherListeners.submit({ target: ruleForm, preventDefault() {} });
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(savedRules.at(-1), ['world', '新的世界态势提示词'], '保存提示词必须提交正确规则与文本');
assert.equal(dispatcher.state().editingRule, null, '保存提示词成功后必须退出编辑页');
assert.deepEqual(ruleEditorStates.at(-1), [false, 'world'], '保存提示词成功后必须通知控制器恢复来源页面');
assert.equal(dispatcherStatuses.at(-1), '提示词已保存。', '保存提示词成功后必须使用中文状态反馈');
dispatcherListeners.click({ target: worldRuleButton });
await Promise.resolve();
rejectRuleSave = true;
const statusCountBeforeFailedRuleSave = dispatcherStatuses.length;
ruleForm.values.text = '保存失败时保留的提示词';
dispatcherListeners.submit({ target: ruleForm, preventDefault() {} });
await new Promise(resolve => setImmediate(resolve));
assert.match(dispatcherErrors.at(-1)?.message || '', /rule save blocked/, '保存提示词失败必须进入错误路径');
assert.equal(dispatcher.state().editingRule, 'world', '保存提示词失败后必须留在编辑页');
assert.equal(dispatcher.state().ruleDraft, '保存失败时保留的提示词', '保存提示词失败后必须保留草稿');
assert.equal(dispatcherStatuses.length, statusCountBeforeFailedRuleSave, '保存提示词失败不得新增成功反馈');
globalThis.FormData = originalFormData;
await dispatcher.open('world');
const worldModuleToggle = { disabled: false, dataset: { action: 'today-trend-toggle-menu', menuId: 'world-module' }, closest: () => worldModuleToggle };
dispatcherListeners.click({ target: worldModuleToggle });
await Promise.resolve();
assert.equal(dispatcher.state().menuOpenId, 'world-module', '世界态势模块菜单必须可正常展开');
const worldRefreshButton = { disabled: false, dataset: { action: 'today-trend-refresh-world-item', worldItemId: 'world-brief' }, closest: () => worldRefreshButton };
dispatcherListeners.click({ target: worldRefreshButton });
await Promise.resolve();
assert.deepEqual(refreshedTargets, [['world', 'world-brief']], '世界态势次级摘要内联刷新必须分发正确项目 ID');
assert.equal(dispatcher.state().menuOpenId, null, '触发世界态势摘要内联动作后必须关闭模块菜单');
dispatcherListeners.click({ target: worldModuleToggle });
await Promise.resolve();
const worldEditButton = { disabled: false, dataset: { action: 'today-trend-edit-world-item', worldItemId: 'world-terminal' }, closest: () => worldEditButton };
dispatcherListeners.click({ target: worldEditButton });
await Promise.resolve();
assert.equal(dispatcher.state().editingWorldItemId, 'world-terminal', '世界态势次级摘要内联编辑必须进入正确项目');
assert.equal(dispatcher.state().menuOpenId, null, '进入世界态势摘要编辑后必须关闭模块菜单');
const archivedTabButton = { disabled: false, dataset: { action: 'today-trend-set-dynamics-tab', tab: 'archived' }, closest: () => archivedTabButton };
dispatcherListeners.click({ target: archivedTabButton });
await Promise.resolve();
assert.equal(dispatcher.state().dynamicsTab, 'archived', '事件追踪 tab 切换必须保存在内存视图态');
await dispatcher.open('world');
await dispatcher.open('dynamics');
assert.equal(dispatcher.state().dynamicsTab, 'active', '从其他模块重新进入事件追踪必须恢复默认 active tab');
const tabButtons = {
    active: { disabled: false, dataset: { action: 'today-trend-set-dynamics-tab', tab: 'active' }, closest: () => tabButtons.active },
    archived: { disabled: false, dataset: { action: 'today-trend-set-dynamics-tab', tab: 'archived' }, closest: () => tabButtons.archived },
};
dispatcherContainer.querySelectorAll = selector => selector.includes('set-dynamics-tab') ? [tabButtons.active, tabButtons.archived] : [];
dispatcherListeners.keydown({ target: tabButtons.active, key: 'ArrowRight', preventDefault() {} });
await Promise.resolve();
assert.equal(dispatcher.state().dynamicsTab, 'archived', '事件 tab 必须支持 ArrowRight 键盘切换');
dispatcher.destroy();

let statusStore = structuredClone(valid);
let statusCommitCount = 0;
const statusMessages = [];
const statusErrors = [];
const statusListeners = {};
let statusOptions = [];
let cycleCircleOption = null;
let cycleFactionOption = null;
const statusContainer = {
    addEventListener: (type, listener) => { statusListeners[type] = listener; }, removeEventListener: () => {}, contains: () => true,
    querySelectorAll: selector => selector.includes('today-trend-set-circle-status') ? statusOptions
        : selector.includes('today-trend-cycle-circle-status') ? [cycleCircleOption]
        : selector.includes('today-trend-cycle-faction-status') ? [cycleFactionOption]
        : [],
};
const statusDispatcher = createTodayTrendActionDispatcher({
    container: statusContainer,
    getStorageId: () => 'chat', getStore: async () => statusStore,
    committer: { commitScope: async (storageId, mutate) => {
        statusCommitCount += 1;
        const scope = await mutate(structuredClone(statusStore.scopes[storageId]));
        statusStore = { ...statusStore, scopes: { ...statusStore.scopes, [storageId]: scope } };
        return statusStore;
    } },
    render: async () => { refreshStatusTargets(); }, onStatus: message => statusMessages.push(message), onError: error => statusErrors.push(error),
});
const statusButton = dataset => {
    const button = { disabled: false, dataset: { action: 'today-trend-set-circle-status', ...dataset }, focusCount: 0 };
    button.closest = () => button;
    button.focus = () => { button.focusCount += 1; };
    return button;
};
const cycleButton = dataset => {
    const button = { disabled: false, dataset, focusCount: 0 };
    button.closest = () => button;
    button.focus = () => { button.focusCount += 1; };
    return button;
};
const refreshStatusTargets = () => {
    statusOptions = TODAY_TREND_RELATION_STATUSES.map(status => statusButton({ circleId: 'judge', status }));
    cycleCircleOption = cycleButton({ action: 'today-trend-cycle-circle-status', circleId: 'judge' });
    cycleFactionOption = cycleButton({ action: 'today-trend-cycle-faction-status', factionId: 'red' });
};
refreshStatusTargets();
statusListeners.click({ target: statusButton({ circleId: 'judge', status: 'like' }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(statusStore.scopes.chat.reputation.circles.find(circle => circle.id === 'judge').status, 'like', '点击好感度按钮必须仅更新目标圈层状态');
assert.equal(statusCommitCount, 1, '修改好感度必须走正式提交链');
assert.deepEqual(statusMessages, ['个人风评好感度已更新。'], '好感度提交成功后必须报告状态');
assert.equal(statusOptions.find(option => option.dataset.status === 'like')?.focusCount, 1, '点击好感度按钮未提供焦点目标时，重绘后必须恢复新状态按钮焦点');
statusListeners.click({ target: statusButton({ circleId: 'judge', status: 'like' }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(statusCommitCount, 1, '点击当前好感度不得产生无意义提交');
statusListeners.click({ target: statusButton({ circleId: 'judge', status: 'invalid' }) });
statusListeners.click({ target: statusButton({ circleId: 'missing', status: 'trust' }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(statusErrors.length, 2, '非法状态或缺失圈层必须进入错误路径');
statusListeners.click({ target: cycleButton({ action: 'today-trend-cycle-circle-status', circleId: 'judge' }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(statusStore.scopes.chat.reputation.circles.find(circle => circle.id === 'judge').status, 'trust', '个人风评极简图标必须按固定顺序切换至下一状态');
assert.equal(cycleCircleOption.focusCount, 1, '个人风评极简图标提交重绘后必须恢复按钮焦点');
statusListeners.click({ target: cycleButton({ action: 'today-trend-cycle-circle-status', circleId: 'judge' }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(statusStore.scopes.chat.reputation.circles.find(circle => circle.id === 'judge').status, 'hostile', '个人风评极简图标必须从信任循环回敌对');
statusListeners.click({ target: cycleButton({ action: 'today-trend-cycle-faction-status', factionId: 'red' }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(statusStore.scopes.chat.factions.find(faction => faction.id === 'red').relation.status, 'trust', '势力极简图标必须按固定顺序切换关系状态');
assert.equal(statusStore.scopes.chat.factions.find(faction => faction.id === 'red').relation.evaluation, '认可配合能力', '势力关系切换不得丢失评价内容');
assert.equal(cycleFactionOption.focusCount, 1, '势力极简图标提交重绘后必须恢复按钮焦点');
statusDispatcher.destroy();
let keyboardStore = structuredClone(valid);
let keyboardOptions = [];
const keyboardListeners = {};
const keyboardContainer = {
    addEventListener: (type, listener) => { keyboardListeners[type] = listener; },
    removeEventListener: (type, listener) => {
        assert.equal(keyboardListeners[type], listener, `动作分发器必须使用原监听器解绑 ${type}`);
        delete keyboardListeners[type];
    },
    contains: () => true,
    querySelectorAll: () => keyboardOptions,
};
const keyboardGroup = { querySelectorAll: () => keyboardOptions };
const createKeyboardOption = status => {
    const option = { disabled: false, dataset: { action: 'today-trend-set-circle-status', circleId: 'judge', status }, focusCount: 0 };
    option.closest = selector => selector === 'button[data-action]' || selector === 'button[data-action="today-trend-set-circle-status"]' ? option : selector === '[role="radiogroup"]' ? keyboardGroup : null;
    option.focus = () => { option.focusCount += 1; };
    return option;
};
const refreshKeyboardOptions = () => { keyboardOptions = TODAY_TREND_RELATION_STATUSES.map(createKeyboardOption); };
refreshKeyboardOptions();
let keyboardCommitCount = 0;
const keyboardDispatcher = createTodayTrendActionDispatcher({
    container: keyboardContainer, getStorageId: () => 'chat', getStore: async () => keyboardStore,
    committer: { commitScope: async (storageId, mutate) => {
        keyboardCommitCount += 1;
        const scope = await mutate(structuredClone(keyboardStore.scopes[storageId]));
        keyboardStore = { ...keyboardStore, scopes: { ...keyboardStore.scopes, [storageId]: scope } };
        return keyboardStore;
    } },
    render: async () => { refreshKeyboardOptions(); },
});
assert.deepEqual(Object.keys(keyboardListeners).sort(), ['click', 'keydown', 'submit'], '动作分发器必须注册完整的事件代理集合');
let keyboardPrevented = false;
keyboardListeners.keydown({ target: keyboardOptions[2], key: 'ArrowRight', preventDefault: () => { keyboardPrevented = true; } });
await new Promise(resolve => setImmediate(resolve));
assert.equal(keyboardPrevented, true, '风评方向键必须阻止默认滚动行为');
assert.equal(keyboardStore.scopes.chat.reputation.circles.find(circle => circle.id === 'judge').status, 'like', '风评方向键必须提交相邻状态');
assert.equal(keyboardCommitCount, 1, '风评方向键必须复用正式提交链');
assert.equal(keyboardOptions.find(option => option.dataset.status === 'like')?.focusCount, 1, '风评提交重绘后必须恢复目标单选按钮焦点');
keyboardListeners.keydown({ target: keyboardOptions.find(option => option.dataset.status === 'like'), key: 'End', preventDefault: () => {} });
await new Promise(resolve => setImmediate(resolve));
assert.equal(keyboardStore.scopes.chat.reputation.circles.find(circle => circle.id === 'judge').status, 'trust', '风评 End 键必须跳至末项并保持可继续导航');
assert.equal(keyboardOptions.find(option => option.dataset.status === 'trust')?.focusCount, 1, '风评连续键盘操作后的重绘必须继续恢复焦点');
keyboardDispatcher.destroy();
assert.deepEqual(Object.keys(keyboardListeners), [], '销毁动作分发器必须解绑 keydown 代理事件');
let concurrentStore = structuredClone(valid);
let concurrentOptions = [];
const concurrentListeners = {};
const concurrentContainer = {
    addEventListener: (type, listener) => { concurrentListeners[type] = listener; },
    removeEventListener: (type, listener) => {
        assert.equal(concurrentListeners[type], listener, `并发测试必须使用原监听器解绑 ${type}`);
        delete concurrentListeners[type];
    },
    contains: () => true,
    querySelectorAll: () => concurrentOptions,
};
const concurrentGroup = { querySelectorAll: () => concurrentOptions };
const createConcurrentOption = status => {
    const option = { disabled: false, dataset: { action: 'today-trend-set-circle-status', circleId: 'judge', status }, focusCount: 0 };
    option.closest = selector => selector === 'button[data-action]' || selector === 'button[data-action="today-trend-set-circle-status"]' ? option : selector === '[role="radiogroup"]' ? concurrentGroup : null;
    option.focus = () => { option.focusCount += 1; };
    return option;
};
const refreshConcurrentOptions = () => { concurrentOptions = TODAY_TREND_RELATION_STATUSES.map(createConcurrentOption); };
refreshConcurrentOptions();
let resolveStaleRender;
let concurrentRenderCalls = 0;
const concurrentDispatcher = createTodayTrendActionDispatcher({
    container: concurrentContainer, getStorageId: () => 'chat', getStore: async () => concurrentStore,
    committer: { commitScope: async (storageId, mutate) => {
        const scope = await mutate(structuredClone(concurrentStore.scopes[storageId]));
        concurrentStore = { ...concurrentStore, scopes: { ...concurrentStore.scopes, [storageId]: scope } };
        return concurrentStore;
    } },
    render: async () => {
        concurrentRenderCalls += 1;
        if (concurrentRenderCalls === 1) return new Promise(resolve => { resolveStaleRender = () => resolve(true); });
        refreshConcurrentOptions();
        return true;
    },
});
concurrentListeners.keydown({ target: concurrentOptions[2], key: 'ArrowRight', preventDefault: () => {} });
await new Promise(resolve => setImmediate(resolve));
assert.equal(concurrentRenderCalls, 1, '首次键盘提交必须进入可被淘汰的异步重绘');
concurrentListeners.keydown({ target: concurrentOptions[3], key: 'End', preventDefault: () => {} });
await new Promise(resolve => setImmediate(resolve));
assert.equal(concurrentStore.scopes.chat.reputation.circles.find(circle => circle.id === 'judge').status, 'trust', '连续键盘提交必须以最后一次状态为准');
assert.equal(concurrentOptions.find(option => option.dataset.status === 'trust')?.focusCount, 1, '最新重绘必须聚焦最后一次键盘目标');
resolveStaleRender();
await new Promise(resolve => setImmediate(resolve));
assert.equal(concurrentOptions.find(option => option.dataset.status === 'like')?.focusCount, 0, '过期重绘不得抢回旧键盘目标焦点');
concurrentDispatcher.destroy();
assert.deepEqual(Object.keys(concurrentListeners), [], '并发测试销毁后必须解绑全部监听器');
const failedStatusErrors = [];
const failedStatusMessages = [];
const failedStatusListeners = {};
const failedStatusDispatcher = createTodayTrendActionDispatcher({
    container: { addEventListener: (type, listener) => { failedStatusListeners[type] = listener; }, removeEventListener: () => {}, contains: () => true },
    getStorageId: () => 'chat', getStore: async () => valid,
    committer: { commitScope: async () => { throw new Error('status write blocked'); } }, render: async () => {},
    onStatus: message => failedStatusMessages.push(message), onError: error => failedStatusErrors.push(error),
});
failedStatusListeners.click({ target: statusButton({ circleId: 'judge', status: 'like' }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(failedStatusMessages.length, 0, '好感度保存失败不得报告成功');
assert.match(failedStatusErrors[0]?.message || '', /status write blocked/, '好感度保存失败必须进入错误路径');
failedStatusDispatcher.destroy();


const multiWorldScope = structuredClone(valid.scopes.chat);
multiWorldScope.world.items.push({ id: 'audience', name: '观众情绪', summary: '仍在期待决赛' });
const targetedSignal = new AbortController().signal;
const targetedUpdate = await createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async (_systemPrompt, _userPrompt, options) => {
        assert.equal(options.isolated, true, '单项刷新必须维持独立 AI transport');
        assert.equal(options.signal, targetedSignal, '单项刷新必须传递调用方取消信号');
        return JSON.stringify({ world: { items: [
            { id: 'world', name: '节目风向', summary: '晚餐服务进入收尾' },
            { id: 'audience', name: '观众情绪', summary: '仍在期待决赛' },
        ] }, reputation: null, factions: null, dynamics: null });
    },
}).generate({ scope: multiWorldScope, preset: valid.presets.preset, target: { module: 'world', itemId: 'world' }, signal: targetedSignal });
assert.equal(targetedUpdate.scope.world.items.find(item => item.id === 'world').summary, '晚餐服务进入收尾', '世界态势单项刷新必须目标项目');
assert.equal(targetedUpdate.scope.world.items.find(item => item.id === 'audience').summary, '仍在期待决赛', '世界态势单项刷新不得覆盖其他项目');
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: { items: [{ id: 'world', name: '节目风向', summary: '越界更新' }] }, reputation: null, factions: null, dynamics: null }),
}).generate({ scope: multiWorldScope, preset: valid.presets.preset, target: { module: 'world', itemId: 'world' } }), /不得新增、删除、替换或重排项目/, '单项刷新不得删除同模块其他项目');
let invalidTargetGathered = 0;
let invalidTargetCalled = 0;
const invalidTargetController = createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => { invalidTargetGathered += 1; return collectedContext; },
    callAI: async () => { invalidTargetCalled += 1; return ''; },
});
await assert.rejects(() => invalidTargetController.generate({ scope: valid.scopes.chat, preset: valid.presets.preset, target: { module: 'unknown' } }), /生成目标无效/, '非法目标模块必须在生成前拒绝');
await assert.rejects(() => invalidTargetController.generate({ scope: valid.scopes.chat, preset: valid.presets.preset, target: { module: 'reputation', itemId: 'judge', mode: 'scehma' } }), /生成目标无效/, '拼错的目标模式不得静默降级为普通刷新');
await assert.rejects(() => invalidTargetController.generate({ scope: valid.scopes.chat, preset: valid.presets.preset, target: { module: 'world', itemId: 'world', mode: 'schema' } }), /生成目标无效/, '圈层结构模式不得用于非风评模块');
assert.equal(invalidTargetGathered, 0, '非法目标不得读取生成上下文');
assert.equal(invalidTargetCalled, 0, '非法目标不得调用 AI');

const multiCircleScope = structuredClone(valid.scopes.chat);
multiCircleScope.reputation.circles.push({ id: 'audience-circle', name: '普通观众', scope: '节目现场观众', status: 'like', evaluation: '期待他的发挥' });
const schemaRefresh = await createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: { circles: [
        { ...multiCircleScope.reputation.circles[0], name: '专业评委', scope: '节目专业评审团' },
        multiCircleScope.reputation.circles[1],
    ] }, factions: null, dynamics: null }),
}).generate({ scope: multiCircleScope, preset: valid.presets.preset, target: { module: 'reputation', itemId: 'judge', mode: 'schema' } });
assert.equal(schemaRefresh.scope.reputation.circles[0].name, '专业评委', '圈层结构刷新必须允许更新目标名称');
assert.equal(schemaRefresh.scope.reputation.circles[0].status, 'neutral', '圈层结构刷新必须保留目标状态');
assert.equal(schemaRefresh.scope.reputation.circles[1].evaluation, '期待他的发挥', '圈层结构刷新不得改写其他圈层');
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: { circles: [
        { ...multiCircleScope.reputation.circles[0], status: 'trust' }, multiCircleScope.reputation.circles[1],
    ] }, factions: null, dynamics: null }),
}).generate({ scope: multiCircleScope, preset: valid.presets.preset, target: { module: 'reputation', itemId: 'judge', mode: 'schema' } }), /不得改写关系状态或评价/, '圈层结构刷新不得改写目标状态或评价');
await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: { circles: [
        multiCircleScope.reputation.circles[0], { ...multiCircleScope.reputation.circles[1], evaluation: '越界改写' },
    ] }, factions: null, dynamics: null }),
}).generate({ scope: multiCircleScope, preset: valid.presets.preset, target: { module: 'reputation', itemId: 'judge' } }), /不得改写其他项目/, '单圈层刷新不得改写其他圈层');
const factionRefresh = await createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: [
        { ...valid.scopes.chat.factions[0], details: [{ label: '队长', value: '阿红' }, { label: '据点', value: '西侧厨房' }] }, valid.scopes.chat.factions[1],
    ], dynamics: null }),
}).generate({ scope: valid.scopes.chat, preset: valid.presets.preset, target: { module: 'faction', itemId: 'red' } });
assert.equal(factionRefresh.scope.factions[0].details[1].value, '西侧厨房', '单势力刷新必须允许更新目标势力');
const reorderedFactionRefresh = await createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: [
        { ...valid.scopes.chat.factions[0], summary: '参赛主力队伍' },
        { relation: { evaluation: '正在观察', status: 'neutral' }, details: [], relatedFactionIds: [], parentId: 'red', summary: '制作单位', name: '节目组', id: 'station' },
    ], dynamics: null }),
}).generate({ scope: valid.scopes.chat, preset: valid.presets.preset, target: { module: 'faction', itemId: 'red' } });
assert.equal(reorderedFactionRefresh.scope.factions[1].name, '节目组', '单势力刷新必须接受字段顺序不同但语义相同的未修改势力');
const generatedFactionCleanup = await createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: [
        { ...valid.scopes.chat.factions[0], relatedFactionIds: ['station', 'field-team'] },
        { ...valid.scopes.chat.factions[1], relatedFactionIds: ['red'] },
        { id: 'field-team', name: '外场组', summary: '节目外场执行单位', parentId: 'station', relatedFactionIds: ['red', 'rival'], details: [], relation: { status: 'neutral', evaluation: '按计划协作' } },
        { id: 'rival', name: '蓝队', summary: '独立参赛队伍', parentId: null, relatedFactionIds: ['field-team'], details: [], relation: { status: 'dislike', evaluation: '存在竞争' } },
    ], dynamics: null }),
}).generate({ scope: valid.scopes.chat, preset: valid.presets.preset });
const cleanedRed = generatedFactionCleanup.scope.factions.find(faction => faction.id === 'red');
const cleanedStation = generatedFactionCleanup.scope.factions.find(faction => faction.id === 'station');
const cleanedFieldTeam = generatedFactionCleanup.scope.factions.find(faction => faction.id === 'field-team');
const cleanedRival = generatedFactionCleanup.scope.factions.find(faction => faction.id === 'rival');
assert.deepEqual(cleanedRed.relatedFactionIds, ['field-team'], '增量生成必须清理父势力指向直接子势力的重复外部关联');
assert.deepEqual(cleanedStation.relatedFactionIds, [], '增量生成必须清理子势力指向直接父势力的重复外部关联');
assert.deepEqual(cleanedFieldTeam.relatedFactionIds, ['red', 'rival'], '非直接父子与合法横向外部关联必须保留');
assert.deepEqual(cleanedRival.relatedFactionIds, ['field-team'], '合法横向外部关联不得被清理');

await assert.rejects(() => createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({ world: null, reputation: null, factions: [
        valid.scopes.chat.factions[0], { ...valid.scopes.chat.factions[1], summary: '越界改写' },
    ], dynamics: null }),
}).generate({ scope: valid.scopes.chat, preset: valid.presets.preset, target: { module: 'faction', itemId: 'red' } }), /不得改写其他项目/, '单势力刷新不得改写其他势力');


let scheduledStore = structuredClone(valid);
scheduledStore.scopes.chat.operation = { ...scheduledStore.scopes.chat.operation, enabled: true, mode: 'auto', intervalFloors: 2, lastSuccessfulAssistantCount: 1 };
const schedulerCommitter = createTodayTrendCommitter({
    load: async () => scheduledStore,
    save: async value => { scheduledStore = structuredClone(value); return scheduledStore; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
let scheduledHostFloor = 3402;
let schedulerCalls = 0;
const scheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => {
        schedulerCalls += 1;
        return {
            scope: { ...scope, world: { items: [{ ...scope.world.items[0], summary: `已更新${schedulerCalls}` }] } },
        };
    } },
    committer: schedulerCommitter, getStore: async () => scheduledStore, getStorageId: () => 'chat',
    getChat: () => [{ mes: '第一楼' }, { mes: '第二楼' }, { mes: '第三楼' }], getFloor: () => scheduledHostFloor, now: () => 100,
});
const autoSnapshot = scheduler.observe([{ mes: '第一楼' }, { mes: '第二楼' }, { mes: '第三楼' }]);
assert.match(autoSnapshot.key, /^[0-9a-f]{32}$/, '调度快照必须使用至少 128-bit 的固定长度指纹');
assert.equal(autoSnapshot.messageCount, 3, '调度快照必须保留有效消息数');
assert.equal(autoSnapshot.assistantCount, 3, '调度快照必须保留独立的 assistant 正文统计');
assert.equal(autoSnapshot.floor, 3402, '调度楼层必须优先采用宿主原生消息编号');
assert.equal(autoSnapshot.lastRole, 'assistant', '调度快照必须保留末消息角色');
assert.match(autoSnapshot.lastMessageFingerprint, /^[0-9a-f]{32}$/, '调度快照必须保留固定长度末消息指纹');
assert.ok(JSON.stringify(autoSnapshot).length < 512, '单个调度快照的稳定表示必须小于 512 bytes');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(schedulerCalls, 1, '达到每 N 楼阈值后必须只启动一次统一生成');
assert.equal(scheduledStore.scopes.chat.operation.lastSuccessfulAssistantCount, 3402, '自动成功后必须把 checkpoint 推进到宿主原生楼层');
const roleParsingScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => ({ scope }) }, committer: schedulerCommitter,
    getStore: async () => ({ scopes: {} }), getStorageId: () => 'role-parsing-chat',
});
const nonAssistantSnapshot = roleParsingScheduler.observe([{ role: 'user', content: '用户消息' }, { role: 'system', content: '旁白消息', extra: { type: 'narrator' } }]);
assert.equal(nonAssistantSnapshot.assistantCount, 0, 'role/content 形态的用户和 narrator 消息不得被误判为 assistant 楼层');
assert.equal(nonAssistantSnapshot.lastIsAssistant, false, '非 assistant 尾消息必须阻止自动生成调度');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(schedulerCalls, 1, '非 assistant 尾消息不得启动额外自动生成');
scheduledStore.scopes.chat.operation.lastSuccessfulAssistantCount = 3400;
scheduledHostFloor = 3404;
const longChat = Array.from({ length: 82 }, (_, index) => ({ mes: `第${index + 1}楼` }));
scheduler.observe(longChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(schedulerCalls, 2, '宿主原生楼层达到阈值后必须继续调度');
await scheduler.manual();
assert.equal(schedulerCalls, 3, '手动本轮生成必须复用统一生成链');
assert.equal(scheduledStore.scopes.chat.operation.lastSuccessfulAssistantCount, 3404, '手动成功必须同步宿主原生楼层 checkpoint');

const snapshotOnlyScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => ({ scope }) },
    committer: schedulerCommitter,
    getStore: async () => ({ scopes: {} }),
    getStorageId: () => 'snapshot-chat',
});
const largeSnapshot = snapshotOnlyScheduler.observe(Array.from({ length: 200 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: `${index}:` + '长正文'.repeat(680),
})));
assert.equal(largeSnapshot.key.length, autoSnapshot.key.length, '会话指纹长度不得随消息数或正文总量增长');
assert.ok(JSON.stringify(largeSnapshot).length < 512, '长聊天快照不得常驻正文或按消息数增长的摘要 key');
await Promise.resolve();
assert.equal(snapshotOnlyScheduler.state().observationCount, 0, '存储中不存在的 scope 不得留下孤儿 observation');

let capacityStorageId = 'capacity-0';
const capacityScopes = Object.fromEntries(Array.from({ length: 81 }, (_, index) => [
    `capacity-${index}`,
    { operation: { enabled: false, mode: 'manual', intervalFloors: 2, lastSuccessfulAssistantCount: 0 } },
]));
const capacityScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => ({ scope }) },
    committer: schedulerCommitter,
    getStore: async () => ({ scopes: capacityScopes }),
    getStorageId: () => capacityStorageId,
});
for (let index = 0; index < 81; index += 1) {
    capacityStorageId = `capacity-${index}`;
    capacityScheduler.observe([{ role: 'assistant', content: `容量消息${index}` }]);
    await Promise.resolve();
}
assert.equal(capacityScheduler.state().observationCount, 80, '跨聊天 observation 状态表必须限制为 80 项');
capacityStorageId = 'capacity-role';
capacityScopes[capacityStorageId] = { operation: { enabled: false, mode: 'manual', intervalFloors: 2, lastSuccessfulAssistantCount: 0 } };
const roleSnapshot = capacityScheduler.observe([{ role: 'user', content: '相同正文' }, { role: 'assistant', content: '收尾' }]);
const boundarySnapshot = capacityScheduler.observe([{ role: 'assistant', content: '相同正文' }, { role: 'assistant', content: '收尾' }]);
const splitSnapshot = capacityScheduler.observe([{ role: 'assistant', content: '相同' }, { role: 'assistant', content: '正文' }, { role: 'assistant', content: '收尾' }]);
assert.notEqual(roleSnapshot.key, boundarySnapshot.key, '会话指纹必须编码消息角色域');
assert.notEqual(boundarySnapshot.key, splitSnapshot.key, '会话指纹必须编码消息边界和顺序');

let targetedSchedulerStore = structuredClone(valid);
const targetedSchedulerCommitter = createTodayTrendCommitter({
    load: async () => targetedSchedulerStore,
    save: async value => { targetedSchedulerStore = structuredClone(value); return targetedSchedulerStore; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
const targetedScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => ({ scope: { ...scope, world: { items: [{ ...scope.world.items[0], summary: '定向更新' }] } } }) },
    committer: targetedSchedulerCommitter, getStore: async () => targetedSchedulerStore, getStorageId: () => 'chat', getChat: () => Array.from({ length: 12 }, (_, index) => ({ mes: `第${index + 1}楼` })),
});
targetedScheduler.arm('chat', Array.from({ length: 10 }, (_, index) => ({ mes: `旧楼${index + 1}` })));
const targetedSnapshotCount = targetedSchedulerStore.scopes.chat.generationSnapshots.length;
await targetedScheduler.run({ kind: 'manual', floor: 12, target: { module: 'world', itemId: 'world' } });
assert.equal(targetedSchedulerStore.scopes.chat.operation.lastSuccessfulAssistantCount, 7, '定向刷新不得推进持久化楼层 checkpoint');
assert.equal(targetedSchedulerStore.scopes.chat.generationSnapshots.length, targetedSnapshotCount, '定向刷新不得新增完整生成快照');
assert.equal(targetedScheduler.state().baselines.chat, 10, '定向刷新不得推进自动调度基线');

let armedHostFloor = 3404;
let armCalls = 0;
const armedScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => { armCalls += 1; return { scope }; } }, committer: schedulerCommitter,
    getStore: async () => scheduledStore, getStorageId: () => 'chat', getFloor: () => armedHostFloor,
});
const initialChat = Array.from({ length: 10 }, (_, index) => ({ mes: `旧楼层${index}` }));
assert.equal(armedScheduler.arm('chat', initialChat), 3404, '开始运作必须立即记录宿主原生楼层基线');
const newlyCompleted = [...initialChat, { mes: '新楼层1' }, { mes: '新楼层2' }];
armedHostFloor = 3406;
armedScheduler.observe(newlyCompleted);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(armCalls, 1, '启用后恰好新增 N 楼时必须触发，不能吞掉首条新增正文');

let identityCalls = 0;
let identityStore = structuredClone(valid);
identityStore.scopes.chat.operation = { ...identityStore.scopes.chat.operation, enabled: true, mode: 'auto', intervalFloors: 2, lastSuccessfulAssistantCount: 2 };
const identityCommitter = createTodayTrendCommitter({
    load: async () => identityStore,
    save: async value => { identityStore = structuredClone(value); return identityStore; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
let identityChat = [{ mes: '旧楼层一' }, { mes: '旧楼层二' }];
const identityScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => { identityCalls += 1; return { scope }; } },
    committer: identityCommitter, getStore: async () => identityStore, getStorageId: () => 'chat', getChat: () => identityChat,
});
identityScheduler.arm('chat', identityChat);
identityChat[1].mes = '旧楼层二（已编辑）';
identityScheduler.observe(identityChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(identityCalls, 0, '编辑既有助手正文不得被当作新楼层');
identityChat.pop();
identityScheduler.observe(identityChat);
for (let index = 0; index < 8 && identityScheduler.state().phase === 'committing'; index += 1) await Promise.resolve();
assert.notEqual(identityScheduler.state().phase, 'committing', '删除助手正文触发的回退提交必须在后续楼层计数前完成');
identityChat.push({ mes: '新增楼层一' });
identityScheduler.observe(identityChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(identityCalls, 0, '删除旧正文后仅新增一楼不得提前触发');
identityChat.push({ mes: '新增楼层二' });
identityScheduler.observe(identityChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(identityCalls, 1, '删除旧正文后新增满 N 楼仍必须触发，不能按存量吞楼');
identityChat[identityChat.length - 1].mes = '新增楼层二（滑动重生成）';
identityScheduler.observe(identityChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(identityCalls, 1, '同一助手楼层的滑动重生成不得重复计数');

const incidentPermissions = [];
const incidentScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope, allowIncident }) => { incidentPermissions.push(allowIncident); return { scope }; } },
    committer: schedulerCommitter, getStore: async () => scheduledStore, getStorageId: () => 'chat', random: () => 0.5,
});
await incidentScheduler.manual({ incidentProbability: 0 });
await incidentScheduler.manual({ incidentProbability: 100 });
await incidentScheduler.manual({ incidentProbability: 50 });
assert.deepEqual(incidentPermissions, [false, true, false], '突发概率必须正确覆盖 0%、100% 和确定性中间投骰');

let queuedAutoCalls = 0;
let releaseQueuedAuto;
let queuedAutoChat = [{ mes: '旧楼层一' }, { mes: '旧楼层二' }];
let queuedAutoHostFloor = 3402;
const queuedAutoGenerationFloors = [];
let queuedAutoStore = structuredClone(valid);
queuedAutoStore.scopes.chat.operation = { ...queuedAutoStore.scopes.chat.operation, enabled: true, mode: 'auto', intervalFloors: 2, lastSuccessfulAssistantCount: 3402 };
const queuedAutoCommitter = createTodayTrendCommitter({
    load: async () => queuedAutoStore,
    save: async value => { queuedAutoStore = structuredClone(value); return queuedAutoStore; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
const queuedAutoScheduler = createTodayTrendScheduler({
    controller: { generate: ({ scope, assistantCount }) => {
        queuedAutoCalls += 1;
        queuedAutoGenerationFloors.push(assistantCount);
        return queuedAutoCalls === 1
            ? new Promise(resolve => { releaseQueuedAuto = () => resolve({ scope }); })
            : Promise.resolve({ scope });
    } },
    committer: queuedAutoCommitter, getStore: async () => queuedAutoStore, getStorageId: () => 'chat', getChat: () => queuedAutoChat,
    getFloor: () => queuedAutoHostFloor,
});
queuedAutoScheduler.arm('chat', queuedAutoChat);
queuedAutoChat.push({ mes: '触发楼层一' }, { mes: '触发楼层二' });
queuedAutoHostFloor = 3404;
queuedAutoScheduler.observe(queuedAutoChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(queuedAutoCalls, 1, '达到阈值时必须只启动一个自动任务');
queuedAutoChat.push({ mes: '生成期间楼层一' }, { mes: '生成期间楼层二' });
queuedAutoHostFloor = 3406;
queuedAutoScheduler.observe(queuedAutoChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(queuedAutoCalls, 1, '生成期间的自动触发必须合并，不能并发调用 AI');
releaseQueuedAuto();
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(queuedAutoCalls, 2, '生成期间累计满下一阈值的新增楼层必须在提交后补调度，不能吞楼');
assert.deepEqual(queuedAutoGenerationFloors, [3404, 3406], '首轮与补调度都必须把宿主原生楼层传入生成链');
assert.equal(queuedAutoStore.scopes.chat.operation.lastSuccessfulAssistantCount, 3406, '补调度成功后必须推进到最新宿主楼层 checkpoint');

let disabledFollowUpCalls = 0;
let releaseDisabledFollowUp;
let disabledFollowUpStore = structuredClone(valid);
disabledFollowUpStore.scopes.chat.operation = { ...disabledFollowUpStore.scopes.chat.operation, enabled: true, mode: 'auto', intervalFloors: 2, lastSuccessfulAssistantCount: 2 };
const disabledFollowUpCommitter = createTodayTrendCommitter({
    load: async () => disabledFollowUpStore,
    save: async value => { disabledFollowUpStore = structuredClone(value); return disabledFollowUpStore; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
const disabledFollowUpScheduler = createTodayTrendScheduler({
    controller: { generate: ({ scope }) => {
        disabledFollowUpCalls += 1;
        return new Promise(resolve => { releaseDisabledFollowUp = () => resolve({ scope }); });
    } },
    committer: disabledFollowUpCommitter, getStore: async () => disabledFollowUpStore,
    getStorageId: () => 'chat', getChat: () => Array.from({ length: 6 }, (_, index) => ({ mes: `关闭自动前楼层${index}` })),
});
disabledFollowUpScheduler.arm('chat', [{ mes: '旧楼一' }, { mes: '旧楼二' }]);
disabledFollowUpScheduler.observe([{ mes: '旧楼一' }, { mes: '旧楼二' }, { mes: '触发一' }, { mes: '触发二' }]);
await new Promise(resolve => setTimeout(resolve, 0));
disabledFollowUpScheduler.observe(Array.from({ length: 6 }, (_, index) => ({ mes: `关闭自动前楼层${index}` })));
releaseDisabledFollowUp();
disabledFollowUpStore.scopes.chat.operation = { ...disabledFollowUpStore.scopes.chat.operation, enabled: false, mode: 'manual' };
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(disabledFollowUpCalls, 1, '补调度真正启动前关闭自动模式时不得继续调用 AI');

const notificationPhases = [];
const notificationScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope, onPhase }) => { onPhase('generating'); onPhase('parsing'); return { scope }; } },
    committer: schedulerCommitter, getStore: async () => scheduledStore, getStorageId: () => 'chat',
});
const unsubscribeNotification = notificationScheduler.subscribe(snapshot => {
    notificationPhases.push(snapshot.phase);
    if (snapshot.task) {
        assert.deepEqual(Object.keys(snapshot.task).sort(), ['floor', 'kind', 'storageId', 'target'], '订阅快照不得暴露 AbortController 或内部任务标识');
        assert.equal(Object.isFrozen(snapshot.task), true, '订阅任务快照必须只读');
    }
});
notificationScheduler.subscribe(() => { throw new Error('listener failure'); });
await notificationScheduler.manual();
for (const phase of ['idle', 'queued', 'generating', 'parsing', 'committing', 'completed']) {
    assert.ok(notificationPhases.includes(phase), `调度订阅必须发布 ${phase} 阶段`);
}
const notificationCount = notificationPhases.length;
assert.equal(unsubscribeNotification(), true, '首次取消订阅必须成功');
assert.equal(unsubscribeNotification(), false, '重复取消订阅必须幂等');
notificationScheduler.acknowledge();
assert.equal(notificationPhases.length, notificationCount, '取消订阅后不得继续收到状态通知');

let releaseLate;
const lateScheduler = createTodayTrendScheduler({
    controller: { generate: () => new Promise(resolve => { releaseLate = resolve; }) }, committer: schedulerCommitter,
    getStore: async () => scheduledStore, getStorageId: () => 'chat',
});
const late = lateScheduler.manual();
await Promise.resolve();
lateScheduler.cancel('test-cancel');
releaseLate({ scope: scheduledStore.scopes.chat });
await assert.rejects(late, error => error?.name === 'AbortError', '取消后迟到结果不得提交');
assert.equal(lateScheduler.state().phase, 'canceled', '取消任务必须保留 canceled 终态');
assert.equal(lateScheduler.state().task.storageId, 'chat', '取消任务必须保留所属聊天供 UI 过滤');
assert.equal(lateScheduler.acknowledge().phase, 'idle', '取消终态被消费后必须回到 idle');
assert.equal(lateScheduler.state().task, null, '取消终态被消费后必须清空任务归属');

const releaseStores = [];
let concurrentCalls = 0;
const concurrentScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => { concurrentCalls += 1; return { scope }; } }, committer: schedulerCommitter,
    getStore: () => new Promise(resolve => { releaseStores.push(() => resolve(scheduledStore)); }), getStorageId: () => 'chat',
});
const firstManual = concurrentScheduler.manual();
await Promise.resolve();
const secondManual = concurrentScheduler.manual();
await Promise.resolve();
releaseStores.splice(0).forEach(release => release());
await assert.rejects(firstManual, error => error?.name === 'AbortError', '新手动请求必须取消尚在读取存储的旧请求');
await secondManual;
assert.equal(concurrentCalls, 1, '并发手动请求不得重复调用 AI');
assert.equal(concurrentScheduler.state().phase, 'completed', '成功任务必须保留 completed 终态供 UI 消费');
assert.equal(concurrentScheduler.acknowledge().phase, 'idle', 'UI 消费终态后必须可回到 idle');

const releases = [];
let overlappingCalls = 0;
const overlapScheduler = createTodayTrendScheduler({
    controller: { generate: ({ scope }) => {
        overlappingCalls += 1;
        return new Promise(resolve => { releases.push(() => resolve({ scope })); });
    } }, committer: schedulerCommitter, getStore: async () => scheduledStore, getStorageId: () => 'chat',
});
const replaced = overlapScheduler.manual();
await new Promise(resolve => setTimeout(resolve, 0));
const replacement = overlapScheduler.manual();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(overlappingCalls, 2, '新手动请求必须在旧 AI 请求尚未返回时启动替代任务');
releases[1]();
await replacement;
assert.equal(overlapScheduler.state().phase, 'completed', '新任务成功后必须保留完成状态');
releases[0]();
await assert.rejects(replaced, error => error?.name === 'AbortError', '被替换的旧 AI 结果必须被取消');
assert.equal(overlapScheduler.state().phase, 'completed', '迟到旧任务不得覆盖新任务完成状态');

let concurrentCrudStore = structuredClone(valid);
let releaseConcurrentCrud;
const concurrentCrudCommitter = createTodayTrendCommitter({
    load: async () => concurrentCrudStore,
    save: async value => { concurrentCrudStore = structuredClone(value); return concurrentCrudStore; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
const concurrentCrudScheduler = createTodayTrendScheduler({
    controller: { generate: ({ scope }) => new Promise(resolve => { releaseConcurrentCrud = () => resolve({
        scope: { ...scope, world: { items: [{ ...scope.world.items[0], summary: '迟到生成结果' }] } },
    }); }) },
    committer: concurrentCrudCommitter, getStore: async () => concurrentCrudStore, getStorageId: () => 'chat',
});
const pendingWorldRefresh = concurrentCrudScheduler.run({ kind: 'manual', target: { module: 'world', itemId: 'world' } });
await new Promise(resolve => setTimeout(resolve, 0));
await concurrentCrudCommitter.commitScope('chat', scope => ({ ...scope, world: { ...scope.world, items: [...scope.world.items, { id: 'manual-world', name: '手动项目', summary: '生成期间保存' }] } }));
releaseConcurrentCrud();
await assert.rejects(pendingWorldRefresh, /生成期间已修改/, '生成期间的世界态势 CRUD 必须使旧生成结果被丢弃');
assert.deepEqual(concurrentCrudStore.scopes.chat.world.items.map(item => item.id), ['world', 'manual-world'], '迟到生成不得覆盖生成期间保存的世界态势项目');

let feedbackStore = structuredClone(valid);
let releaseCommitFeedback;
let feedbackWaitMs = null;
const feedbackCommitter = createTodayTrendCommitter({
    load: async () => feedbackStore,
    save: async value => { feedbackStore = structuredClone(value); return feedbackStore; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
const feedbackScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => ({ scope }) }, committer: feedbackCommitter,
    getStore: async () => feedbackStore, getStorageId: () => 'chat', getChat: () => Array.from({ length: 8 }, (_, index) => ({ mes: `反馈楼层${index}` })),
    now: () => 100, commitFeedbackMs: 240,
    wait: milliseconds => { feedbackWaitMs = milliseconds; return new Promise(resolve => { releaseCommitFeedback = resolve; }); },
});
const feedbackRun = feedbackScheduler.manual();
for (let index = 0; index < 12 && feedbackWaitMs === null; index += 1) await Promise.resolve();
assert.equal(feedbackScheduler.state().phase, 'committing', '持久化完成后必须保留 committing 状态供 UI 展示同步动效');
assert.equal(feedbackWaitMs, 240, 'committing 反馈必须满足配置的最短可见时长');
releaseCommitFeedback();
await feedbackRun;
assert.equal(feedbackScheduler.state().phase, 'completed', '最短反馈结束后任务必须正常完成');

let rollbackStore = structuredClone(valid);
rollbackStore.scopes.chat = appendTodayTrendGenerationSnapshot({
    ...rollbackStore.scopes.chat,
    operation: { ...rollbackStore.scopes.chat.operation, lastSuccessfulAssistantCount: 10, lastSuccessfulRunAt: 12 },
    world: { items: [{ ...rollbackStore.scopes.chat.world.items[0], summary: '第十楼持久化结果' }] },
}, 10, 12);
const rollbackCommitter = createTodayTrendCommitter({
    load: async () => rollbackStore,
    save: async value => { rollbackStore = structuredClone(value); return rollbackStore; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
const rollbackChat = Array.from({ length: 7 }, (_, index) => ({ mes: `回退后楼层${index}` }));
const rollbackScheduler = createTodayTrendScheduler({
    controller: { generate: async () => { throw new Error('回退不得调用 AI'); } }, committer: rollbackCommitter,
    getStore: async () => rollbackStore, getStorageId: () => 'chat', getChat: () => rollbackChat, getFloor: () => 7,
});
assert.equal(createTodayTrendScheduler({ controller: { generate: async ({ scope }) => ({ scope }) }, committer: rollbackCommitter, getStore: async () => rollbackStore, getStorageId: () => 'chat', getChat: () => [{ mes: '内部统计不等于楼层' }], getFloor: () => 3402 }).currentFloor(), 3402, '当前楼层必须完整返回宿主原生多位消息编号');
rollbackScheduler.observe(rollbackChat);
for (let index = 0; index < 8 && rollbackStore.scopes.chat.operation.lastSuccessfulAssistantCount !== 7; index += 1) await Promise.resolve();
assert.equal(rollbackStore.scopes.chat.operation.lastSuccessfulAssistantCount, 7, 'observe 检测到助手楼层下降后必须回退持久化 checkpoint');
assert.equal(rollbackStore.scopes.chat.world.items[0].summary, '晚餐服务临近', 'observe 回退必须恢复上一有效楼层的生成内容');
assert.deepEqual(rollbackStore.scopes.chat.generationSnapshots.map(item => item.assistantCount), [0, 7], 'observe 回退必须删除已消失楼层对应的生成快照并保留初始化基线');

let failedRollbackStorageId = 'chat';
const failedRollbackStore = structuredClone(valid);
failedRollbackStore.scopes.chat.operation = { ...failedRollbackStore.scopes.chat.operation, lastSuccessfulAssistantCount: 10 };
const failedRollbackScheduler = createTodayTrendScheduler({
    controller: { generate: async () => { throw new Error('回退不得调用 AI'); } },
    committer: { invalidateCommits: () => {}, commitStore: async () => { throw new Error('rollback write blocked'); } },
    getStore: async () => failedRollbackStore, getStorageId: () => failedRollbackStorageId,
    getChat: () => Array.from({ length: 7 }, (_, index) => ({ mes: `失败回退楼层${index}` })), getFloor: () => 7,
});
failedRollbackScheduler.observe(Array.from({ length: 7 }, (_, index) => ({ mes: `失败回退楼层${index}` })));
for (let index = 0; index < 12 && failedRollbackScheduler.state().phase !== 'failed'; index += 1) await Promise.resolve();
assert.equal(failedRollbackScheduler.state().phase, 'failed', '回退提交失败必须保留 failed 终态');
assert.equal(failedRollbackScheduler.state().task.storageId, 'chat', '回退提交失败必须保留所属聊天供 UI 过滤');
assert.equal(failedRollbackScheduler.state().lastError, 'rollback write blocked', '回退提交失败必须暴露真实错误说明');
failedRollbackStorageId = 'other';
assert.equal(failedRollbackScheduler.state().task.storageId, 'chat', '切换聊天不得篡改旧终态的任务归属');
assert.equal(failedRollbackScheduler.acknowledge().phase, 'idle', '失败终态被消费后必须回到 idle');
assert.equal(failedRollbackScheduler.state().task, null, '失败终态被消费后必须清空任务归属');

let concurrentRollbackStore = structuredClone(valid);
concurrentRollbackStore.scopes.chat = appendTodayTrendGenerationSnapshot({
    ...concurrentRollbackStore.scopes.chat,
    operation: { ...concurrentRollbackStore.scopes.chat.operation, enabled: true, mode: 'auto', intervalFloors: 2, lastSuccessfulAssistantCount: 3410, lastSuccessfulRunAt: 12 },
    world: { items: [{ ...concurrentRollbackStore.scopes.chat.world.items[0], summary: '并发回退前结果' }] },
}, 3410, 12);
let concurrentRollbackChat = Array.from({ length: 7 }, (_, index) => ({ mes: `并发回退楼层${index}` }));
let concurrentRollbackHostFloor = 3407;
let releaseRollbackCommit;
let rollbackCommitStarted = false;
let blockNextRollbackCommit = true;
let concurrentRollbackCalls = 0;
const concurrentRollbackCommitter = {
    invalidateCommits: () => {},
    commitStore: async mutate => {
        const candidate = await mutate(structuredClone(concurrentRollbackStore));
        if (blockNextRollbackCommit) {
            blockNextRollbackCommit = false;
            rollbackCommitStarted = true;
            await new Promise(resolve => { releaseRollbackCommit = resolve; });
        }
        concurrentRollbackStore = structuredClone(candidate);
        return concurrentRollbackStore;
    },
};
const concurrentRollbackScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => { concurrentRollbackCalls += 1; return { scope }; } },
    committer: concurrentRollbackCommitter, getStore: async () => concurrentRollbackStore,
    getStorageId: () => 'chat', getChat: () => concurrentRollbackChat, getFloor: () => concurrentRollbackHostFloor,
});
concurrentRollbackScheduler.observe(concurrentRollbackChat);
for (let index = 0; index < 12 && !rollbackCommitStarted; index += 1) await Promise.resolve();
assert.equal(concurrentRollbackScheduler.state().phase, 'committing', '回退提交被阻塞时必须保持 committing 状态');
concurrentRollbackChat = [...concurrentRollbackChat, { mes: '回退期间新增一' }, { mes: '回退期间新增二' }];
concurrentRollbackHostFloor = 3409;
concurrentRollbackScheduler.observe(concurrentRollbackChat);
releaseRollbackCommit();
for (let index = 0; index < 20 && concurrentRollbackStore.scopes.chat.operation.lastSuccessfulAssistantCount !== 3409; index += 1) await Promise.resolve();
assert.equal(concurrentRollbackCalls, 1, '回退提交期间累计满阈值的新增楼层必须在回退后补调度一次');
assert.equal(concurrentRollbackStore.scopes.chat.operation.lastSuccessfulAssistantCount, 3409, '回退期间新增宿主楼层不得被 pendingTurns 清零或吞掉');
assert.deepEqual(concurrentRollbackStore.scopes.chat.generationSnapshots.map(item => item.assistantCount), [0, 7, 3409], '回退后补调度必须按宿主楼层重新建立最新快照');

const seededSamples = seed => {
    const random = createSeededRandom(seed);
    return Array.from({ length: 8 }, () => random());
};
const seededRandomA = createSeededRandom('today-trend-v1');
const seededRandomB = createSeededRandom('today-trend-v1');
assert.deepEqual(Array.from({ length: 8 }, () => seededRandomA()), Array.from({ length: 8 }, () => seededRandomB()), '同 seed 必须重放相同随机序列');
assert.deepEqual(seededSamples('today-trend-v1'), [
    0.9704373918939382, 0.38605407858267426, 0.7518562425393611, 0.4772277001757175,
    0.7917709436733276, 0.15437844768166542, 0.18535474338568747, 0.8009844277985394,
], '固定 seed 的 golden vector 不得漂移');
assert.notDeepEqual(seededSamples('today-trend-v1'), seededSamples('today-trend-v2'), '不同 seed 的固定样本不得退化为相同序列');
assert.equal(createSeededRandom(-0).normalizedSeed, 'number:0', '负零 seed 必须规范化为稳定数字零');
assert.equal(normalizeDeterministicSeed(' today-trend-v1 '), 'string:today-trend-v1', '字符串 seed 必须去除边界空白并暴露规范值');
for (const invalidSeed of [null, undefined, '', '   ', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
    assert.throws(() => createSeededRandom(invalidSeed), /seed must be a non-empty string or finite number/, '非法 seed 必须 fail-fast');
}
assert.throws(() => createFaultSchedule([{ step: -1, code: 'TT_NEGATIVE' }]), /non-negative safe integer/, '负数 fault step 必须拒绝');
assert.throws(() => createFaultSchedule([{ step: 1.5, code: 'TT_FRACTION' }]), /non-negative safe integer/, '小数 fault step 必须拒绝');
assert.throws(() => createFaultSchedule([{ step: 1, code: '' }]), /non-empty string/, '空 fault code 必须拒绝');
assert.throws(() => createFaultSchedule([{ step: 1, code: 'TT_ONE' }, { step: 1, code: 'TT_TWO' }]), /duplicate fault step/, '重复 fault step 不得静默覆盖');
assert.throws(() => createFaultSchedule([{ step: 2, code: 'TT_OUTSIDE' }], { steps: 2 }), /lower than steps/, '超出序列的 fault 必须在运行前拒绝');
const isolatedFixtureA = fixture();
isolatedFixtureA.scopes.chat.world.items[0].summary = '已污染';
assert.equal(fixture().scopes.chat.world.items[0].summary, '晚餐服务临近', 'v1 fixture 每次创建必须相互隔离');

const createOwnerSequenceTransition = () => async ({ state, step, sample, fault }) => {
    const registeredListeners = new Map();
    const container = {
        addEventListener: (type, listener) => {
            const listeners = registeredListeners.get(type) || new Set();
            listeners.add(listener);
            registeredListeners.set(type, listeners);
        },
        removeEventListener: (type, listener) => {
            const listeners = registeredListeners.get(type);
            listeners?.delete(listener);
            if (!listeners?.size) registeredListeners.delete(type);
        },
        contains: () => true,
    };
    const dispatcher = createTodayTrendActionDispatcher({
        container, getStorageId: () => 'chat', getStore: async () => fixture(),
        committer: { commitScope: async () => fixture() }, render: async () => {}, confirmImpl: () => true,
    });
    assert.deepEqual([...registeredListeners.keys()].sort(), ['click', 'keydown', 'submit'], '真实 dispatcher 必须注册三类代理事件');

    let ownerStore = normalizeTodayTrendStore(fixture());
    const ownerCommitter = createTodayTrendCommitter({
        load: async () => ownerStore,
        save: async value => { ownerStore = structuredClone(value); return ownerStore; },
        refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
    });
    let observedSignal = null;
    const scheduler = createTodayTrendScheduler({
        controller: { generate: async ({ scope, signal }) => {
            observedSignal = signal;
            if (fault) throw fault;
            return { scope: { ...scope, world: { items: [{ ...scope.world.items[0], summary: `owner-step-${step}-${sample}` }] } } };
        } },
        committer: ownerCommitter, getStore: async () => ownerStore, getStorageId: () => 'chat', getFloor: () => step + 1,
    });
    const schedulerStates = [];
    const unsubscribe = scheduler.subscribe(snapshot => schedulerStates.push(snapshot));
    let transitionError = null;
    let terminalPhase = null;
    let terminalTask = null;
    let notificationsBeforeUnsubscribe = 0;
    let firstUnsubscribeResult = null;
    let secondUnsubscribeResult = null;
    try {
        await scheduler.manual({ storageId: 'chat', floor: step + 1 });
        terminalPhase = scheduler.state().phase;
    } catch (error) {
        transitionError = error;
        terminalPhase = scheduler.state().phase;
    } finally {
        terminalTask = scheduler.state().task;
        notificationsBeforeUnsubscribe = schedulerStates.length;
        try {
            firstUnsubscribeResult = unsubscribe();
            secondUnsubscribeResult = unsubscribe();
            scheduler.cancel('phase-0-owner-cleanup', true);
        } finally {
            dispatcher.destroy();
        }
    }
    assert.ok(observedSignal instanceof AbortSignal, '真实 scheduler 必须向生成控制器传入 AbortSignal');
    assert.equal(terminalPhase, fault ? 'failed' : 'completed', 'scheduler 必须进入与生成结果一致的公开终态');
    assert.deepEqual(terminalTask, fault ? { kind: 'manual', storageId: 'chat', floor: step + 1, target: null } : null, 'scheduler 结束后不得保留 active task；失败只允许保留可观察终态摘要');
    assert.equal(firstUnsubscribeResult, true, 'scheduler 首次 unsubscribe 必须释放真实订阅');
    assert.equal(secondUnsubscribeResult, false, 'scheduler 重复 unsubscribe 不得伪报释放成功');
    assert.equal(schedulerStates.length, notificationsBeforeUnsubscribe, 'unsubscribe 后 scheduler 状态变化不得继续通知旧 listener');
    assert.equal(registeredListeners.size, 0, 'dispatcher.destroy 必须按原引用移除全部代理事件');
    assert.equal(scheduler.state().task, null, '显式 cleanup 后 scheduler 终态 task 摘要必须清除');
    if (transitionError) throw transitionError;
    return {
        state: { completed: (state?.completed || 0) + 1 },
        outcome: { terminalPhase, notifications: schedulerStates.length, listenerCount: registeredListeners.size, signalAborted: observedSignal.aborted },
    };
};

const sequenceOptions = {
    scenarioId: 'phase-0-real-owner-replay', seed: 'phase-0-replay', steps: 20,
    faults: [{ step: 7, code: 'TT_TEST_STORAGE_WRITE' }], fixtureVersion: 'today-trend-v1',
    transition: createOwnerSequenceTransition(),
};
const sequenceA = await runDeterministicSequence(sequenceOptions);
const replayDescriptor = JSON.parse(JSON.stringify(sequenceA.replayDescriptor));
const sequenceB = await runDeterministicSequence({ ...replayDescriptor, transition: createOwnerSequenceTransition() });
assert.deepEqual(sequenceA, sequenceB, '序列化 replay descriptor 必须能在新 transition 与新 options 实例中重放相同结果');
assert.deepEqual(sequenceA.replayDescriptor, {
    schema: 'today-trend-deterministic-sequence', version: 1, scenarioId: 'phase-0-real-owner-replay',
    seed: 'string:phase-0-replay', seedFormat: 'normalized-v1', steps: 20, faults: [{ step: 7, code: 'TT_TEST_STORAGE_WRITE' }],
    fixtureVersion: 'today-trend-v1', firstFailureStep: 7,
}, 'replay descriptor 必须包含版本、场景、JSON 安全规范 seed、故障和首个失败步骤');
assert.ok(Object.isFrozen(sequenceA.replayDescriptor) && Object.isFrozen(sequenceA.replayDescriptor.faults) && Object.isFrozen(sequenceA.replayDescriptor.faults[0]), 'replay descriptor 及其 fault 列表必须深度冻结');
assert.throws(() => { sequenceA.replayDescriptor.faults.push({ step: 9, code: 'TT_MUTATED' }); }, TypeError, '冻结的 replay fault 列表不得追加条目');
assert.deepEqual(sequenceA.trace.filter(entry => entry.status === 'accepted').map(entry => entry.step), [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], 'accepted 步骤必须精确排除 fault step');
assert.deepEqual(sequenceA.trace.filter(entry => entry.status === 'rejected').map(entry => entry.step), [7], 'rejected 步骤必须只包含登记 fault');
assert.deepEqual(sequenceA.trace[7], {
    step: 7, sample: seededSamples('phase-0-replay')[7], fault: 'TT_TEST_STORAGE_WRITE', status: 'rejected',
    error: { code: 'TT_TEST_STORAGE_WRITE', message: 'Injected fault: TT_TEST_STORAGE_WRITE' },
}, 'trace[7] 必须精确记录登记 fault 的 sample、code 与错误摘要');
assert.deepEqual(sequenceA.state, { completed: 19 }, '20 步真实 owner 序列必须成功完成 19 步并拒绝唯一 fault step');
assert.deepEqual(sequenceA.remainingFaults, [], '命中的故障计划必须被消费完毕');
const negativeZeroSequence = await runDeterministicSequence({ seed: -0, steps: 1, transition: () => ({ state: 'ok' }) });
const replayedNegativeZeroSequence = await runDeterministicSequence({
    ...JSON.parse(JSON.stringify(negativeZeroSequence.replayDescriptor)), transition: () => ({ state: 'ok' }),
});
assert.deepEqual(replayedNegativeZeroSequence, negativeZeroSequence, '负零 seed 的 replay descriptor 必须跨 JSON 保持等价');
const immutableRejectedState = await runDeterministicSequence({
    seed: 'rejected-state-isolation', steps: 2, faults: [{ step: 1, code: 'TT_REJECTED_STATE' }],
    transition: ({ state, fault }) => {
        const next = state || { committed: 0 };
        next.committed += 1;
        if (fault) throw fault;
        return { state: next };
    },
});
assert.deepEqual(immutableRejectedState.state, { committed: 1 }, 'rejected step 对 candidate state 的原地修改不得污染已提交 state');
await assert.rejects(() => runDeterministicSequence({
    schema: 'unknown-replay-schema', version: 1, seed: 'unsupported-schema', steps: 1, transition: () => ({ state: null }),
}), /schema or version is unsupported/, '未知 replay schema 必须 fail-closed');
await assert.rejects(() => runDeterministicSequence({
    schema: 'today-trend-deterministic-sequence', version: 2, seed: 'unsupported-version', steps: 1, transition: () => ({ state: null }),
}), /schema or version is unsupported/, '未知 replay version 必须 fail-closed');
await assert.rejects(() => runDeterministicSequence({
    seed: 'uncloneable-state', steps: 1, transition: () => ({ state: { callback: () => {} } }),
}), error => error?.code === 'TT_TEST_INFRASTRUCTURE' && /structured-cloneable/.test(error.message), '不可克隆 transition state 必须在当前步骤立即失败');
await assert.rejects(() => runDeterministicSequence({ seed: 'unexpected-error', steps: 1, transition: () => { throw new Error('assertion escaped'); } }), error => {
    assert.equal(error.code, 'TT_TEST_INFRASTRUCTURE');
    assert.equal(error.firstFailureStep, 0);
    assert.equal(error.cause?.message, 'assertion escaped');
    assert.equal(error.replayDescriptor.firstFailureStep, 0);
    return true;
}, '未登记异常必须作为测试基础设施失败抛出，不能吞为业务拒绝');
await assert.rejects(() => runDeterministicSequence({
    seed: 'missing-fault', steps: 1, faults: [{ step: 0, code: 'TT_EXPECTED' }], transition: () => ({ state: null }),
}), error => error?.code === 'TT_TEST_INFRASTRUCTURE' && error.firstFailureStep === 0, '登记 fault 未抛出时必须立即判定测试基础设施失败');
await assert.rejects(() => runDeterministicSequence({
    seed: 'same-code-impostor', steps: 1, faults: [{ step: 0, code: 'TT_EXPECTED' }],
    transition: () => { const error = new Error('same code, different identity'); error.code = 'TT_EXPECTED'; throw error; },
}), error => error?.code === 'TT_TEST_INFRASTRUCTURE'
    && error.cause?.message === 'same code, different identity', '同 code 的其他异常不得冒充 fault schedule 注入对象');

assert.match(await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/today-trend.js', import.meta.url), 'utf8')),
    /initializeTodayTrend[\s\S]*bindTodayTrendPreset[\s\S]*commitTodayTrendScope/, '安装层必须公开初始化、预设绑定与设置提交接口');
const [phoneCode, scenePhoneCode, sceneCode] = await Promise.all(['today-trend-phone-ui.js', 'interactive-scene-phone.js', 'interactive-scenes.js'].map(async file =>
    import('node:fs/promises').then(({ readFile }) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'))));
assert.match(phoneCode, /persistPhoneUiSnapshot\?\.\(\)/, '展示今日风向后必须保存页面状态');
assert.match(scenePhoneCode, /PHONE_UI_PAGES\.includes\(page\)/, '页面状态保存必须复用统一页面白名单');
assert.match(sceneCode, /lastPage === 'today-trend'[\s\S]*showTodayTrendPage/, '页面恢复必须覆盖今日风向');

const phase4EventId = 'service';
const phase4ProjectionFixtures = {
    legacy: {
        id: 'legacy:service:0001', kind: 'legacy-stage', text: '旧阶段', legacyIndex: 0,
        sourceStageStart: 1, sourceStageEnd: 1, revision: 1,
    },
    live: {
        id: 'live:service:2', kind: 'live-stage', storyDate: '2025-04-14', time: '08:10', timeLabel: null,
        text: '开始修复仓门', sourceStageStart: 2, sourceStageEnd: 2, sourceFloorStart: 44, sourceFloorEnd: 44, revision: 1,
    },
    undated: {
        id: 'undated:service:1', kind: 'undated-stage', storyDate: null, time: null, timeLabel: '清晨', text: '继续巡查',
        undatedSequence: 1, sourceStageStart: 3, sourceStageEnd: 3, sourceFloorStart: null, sourceFloorEnd: null, revision: 1,
    },
    day: {
        id: 'day:service:2025-04-15', kind: 'day-summary', status: 'closed', storyDate: '2025-04-15',
        timeRange: { start: '07:20', end: '22:40', label: null }, summary: '完成仓门修复', keyStages: ['完成加固'],
        detailRefs: ['detail:service:4'], detailCount: 2, sourceStageStart: 4, sourceStageEnd: 5,
        sourceFloorStart: 45, sourceFloorEnd: 46, revision: 1,
    },
    period: {
        id: 'period:service:1', kind: 'period-summary', periodSequence: 1, startDate: '2025-04-15', startTime: '07:20',
        endDate: '2025-04-16', endTime: '22:40', summary: '完成初期修复', childSummaryRefs: ['day:service:2025-04-15'],
        childSummaryCount: 1, historicalDetailCount: 2, sourceStageStart: 6, sourceStageEnd: 7, revision: 1,
    },
    span: {
        id: 'span:service:8', kind: 'span-stage', startDate: '2025-04-17', startTime: null,
        endDate: '2025-04-18', endTime: null, summary: '连续两日整备', sourceStageStart: 8, sourceStageEnd: 8,
        sourceFloorStart: 47, sourceFloorEnd: 48, revision: 1,
    },
};
for (const projection of Object.values(phase4ProjectionFixtures)) {
    assert.deepEqual(normalizeTodayTrendStageProjection(projection, phase4EventId), projection,
        `StageProjection ${projection.kind} 必须通过 closed-set schema`);
}
for (const time of ['00:00', '23:59']) {
    assert.equal(normalizeTodayTrendStageProjection({ ...phase4ProjectionFixtures.live, time }, phase4EventId).time, time,
        `live-stage 必须接受合法边界钟点 ${time}`);
}
for (const projection of [phase4ProjectionFixtures.live, phase4ProjectionFixtures.day]) {
    const dateField = projection.kind === 'live-stage' ? 'storyDate' : 'storyDate';
    for (const invalidDate of ['not-a-date', '2025-02-30']) {
        const candidate = { ...projection, [dateField]: invalidDate };
        if (projection.kind === 'day-summary') candidate.id = `day:service:${invalidDate}`;
        assert.throws(() => normalizeTodayTrendStageProjection(candidate, phase4EventId),
            error => error?.code === 'TT_V2_SCHEMA_INVALID', `${projection.kind} 必须拒绝非法日期 ${invalidDate}`);
    }
}
for (const time of ['24:00', '12:60', '7:30', 'abcde']) {
    for (const projection of [phase4ProjectionFixtures.live, phase4ProjectionFixtures.undated]) {
        assert.throws(() => normalizeTodayTrendStageProjection({ ...projection, time }, phase4EventId),
            error => error?.code === 'TT_V2_SCHEMA_INVALID', `${projection.kind} 必须拒绝非法钟点 ${time}`);
    }
    for (const [projection, fields] of [
        [phase4ProjectionFixtures.period, { startTime: time }],
        [phase4ProjectionFixtures.period, { endTime: time }],
        [phase4ProjectionFixtures.span, { startTime: time, endTime: '22:40' }],
        [phase4ProjectionFixtures.span, { startTime: '07:20', endTime: time }],
    ]) {
        assert.throws(() => normalizeTodayTrendStageProjection({ ...projection, ...fields }, phase4EventId),
            error => error?.code === 'TT_V2_SCHEMA_INVALID', `${projection.kind} 必须拒绝非法钟点 ${time}`);
    }
    for (const timeRange of [
        { start: time, end: '22:40', label: null }, { start: '07:20', end: time, label: null },
    ]) {
        assert.throws(() => normalizeTodayTrendStageProjection({ ...phase4ProjectionFixtures.day, timeRange }, phase4EventId),
            error => error?.code === 'TT_V2_SCHEMA_INVALID', `day-summary 必须拒绝非法钟点 ${time}`);
    }
}
assert.throws(() => normalizeTodayTrendStageProjection({
    ...phase4ProjectionFixtures.day, timeRange: { start: '22:40', end: '07:20', label: null },
}, phase4EventId), error => error?.code === 'TT_V2_SCHEMA_INVALID', 'day-summary 必须拒绝倒序钟点区间');
assert.throws(() => normalizeTodayTrendStageProjection({
    ...phase4ProjectionFixtures.day, timeRange: { start: '07:20', end: null, label: null },
}, phase4EventId), error => error?.code === 'TT_V2_SCHEMA_INVALID', 'day-summary 必须拒绝单端钟点区间');
assert.throws(() => normalizeTodayTrendStageProjection({
    ...phase4ProjectionFixtures.day, timeRange: { start: '07:20', end: '22:40', label: '全天' },
}, phase4EventId), error => error?.code === 'TT_V2_SCHEMA_INVALID', 'day-summary 可靠钟点与自然语言标签不得并存');
assert.throws(() => normalizeTodayTrendStageProjection({
    ...phase4ProjectionFixtures.period, startDate: '2025-04-15', endDate: '2025-04-15', startTime: '22:40', endTime: '07:20',
}, phase4EventId), error => error?.code === 'TT_V2_SCHEMA_INVALID', 'period-summary 必须拒绝同日倒序钟点区间');
for (const projection of [phase4ProjectionFixtures.period, phase4ProjectionFixtures.span]) {
    assert.throws(() => normalizeTodayTrendStageProjection({ ...projection, startTime: '07:20', endTime: null }, phase4EventId),
        error => error?.code === 'TT_V2_SCHEMA_INVALID', `${projection.kind} 必须拒绝仅有起始钟点的区间`);
    assert.throws(() => normalizeTodayTrendStageProjection({ ...projection, startTime: null, endTime: '22:40' }, phase4EventId),
        error => error?.code === 'TT_V2_SCHEMA_INVALID', `${projection.kind} 必须拒绝仅有结束钟点的区间`);
    for (const dateField of ['startDate', 'endDate']) {
        assert.throws(() => normalizeTodayTrendStageProjection({ ...projection, [dateField]: '2025-02-30' }, phase4EventId),
            error => error?.code === 'TT_V2_SCHEMA_INVALID', `${projection.kind} 必须拒绝 ${dateField} 不存在的日期`);
    }
    assert.throws(() => normalizeTodayTrendStageProjection({ ...projection, startDate: '2025-04-19' }, phase4EventId),
        error => error?.code === 'TT_V2_SCHEMA_INVALID', `${projection.kind} 必须拒绝倒序日期区间`);
    assert.deepEqual(normalizeTodayTrendStageProjection({
        ...projection, startDate: '2025-04-17', endDate: '2025-04-18', startTime: '22:40', endTime: '07:20',
    }, phase4EventId), {
        ...projection, startDate: '2025-04-17', endDate: '2025-04-18', startTime: '22:40', endTime: '07:20',
    }, `${projection.kind} 必须接受跨日且结束钟点早于起始钟点的区间`);
    assert.deepEqual(normalizeTodayTrendStageProjection({
        ...projection, startDate: '2025-04-17', endDate: '2025-04-17', startTime: '07:20', endTime: '07:20',
    }, phase4EventId), {
        ...projection, startDate: '2025-04-17', endDate: '2025-04-17', startTime: '07:20', endTime: '07:20',
    }, `${projection.kind} 必须接受同日相等钟点的零长度边界`);
}
assert.throws(() => normalizeTodayTrendStageProjection({
    ...phase4ProjectionFixtures.span, startDate: '2025-04-17', endDate: '2025-04-17', startTime: '22:40', endTime: '07:20',
}, phase4EventId), error => error?.code === 'TT_V2_SCHEMA_INVALID', 'span-stage 必须拒绝同日倒序钟点区间');
assert.throws(() => normalizeTodayTrendStageProjection({ ...phase4ProjectionFixtures.live, kind: 'future-stage' }, phase4EventId),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', '未知 StageProjection kind 必须 fail-closed');
assert.throws(() => normalizeTodayTrendStageProjection({ ...phase4ProjectionFixtures.live, debug: true }, phase4EventId),
    error => {
        assert.equal(error instanceof Error, true, 'schema helper 必须继续抛出原生 Error');
        assert.equal(error.name, 'Error', 'schema helper 不得改变错误类型名称');
        assert.equal(error?.code, 'TT_V2_SCHEMA_INVALID', 'schema helper 必须保留 TT_V2_SCHEMA_INVALID 错误码');
        assert.equal(error?.message, 'live-stage 字段集合无效', 'schema helper 必须保留原字段级诊断消息');
        return true;
    }, 'StageProjection 额外字段必须被 exactKeys 拒绝');
assert.throws(() => normalizeTodayTrendStageProjection({ ...phase4ProjectionFixtures.period, id: 'period:service:2' }, phase4EventId),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', '稳定 period ID 与 sequence 不一致时必须拒绝');
assert.throws(() => normalizeTodayTrendStageProjection({ ...phase4ProjectionFixtures.span, revision: 2 }, phase4EventId),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', 'StageProjection 未知 revision 必须拒绝');
assert.equal(resolveTodayTrendV2LatestStage({
    stages: [phase4ProjectionFixtures.span, phase4ProjectionFixtures.legacy],
}), phase4ProjectionFixtures.span.summary, 'v2 latestStage resolver 必须按最大 source 区间而不是数组物理末项解析');
assert.equal(valid.scopes.chat.dynamics.active[0].latestStage, valid.scopes.chat.dynamics.active[0].stages.at(-1),
    'v1 normalizer 必须继续保持 latestStage 等于字符串 stages 末项');

const phase4Available = structuredClone(migratedValidV2);
const phase4AvailablePayload = phase4Available.globalEnvelope.payload.scopes.chat.payload;
const phase4AvailableEvent = phase4AvailablePayload.dynamics.active[0];
phase4AvailableEvent.stages = [structuredClone(phase4ProjectionFixtures.day)];
phase4AvailableEvent.latestStage = phase4ProjectionFixtures.day.summary;
phase4AvailablePayload.stageDetailsByEvent.service = [{
    id: 'detail:service:4', sourceStageSequence: 4, text: '完成阶段详情', storyDate: '2025-04-15',
}];
const availableDetailState = {
    entityType: 'detail', entityId: 'detail:service:4', eventId: 'service', state: 'available',
    removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
};
const availableDayState = {
    entityType: 'day-summary', entityId: phase4ProjectionFixtures.day.id, eventId: 'service', state: 'available',
    removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
};
phase4AvailablePayload.removableEntityStateById = {
    [availableDetailState.entityId]: availableDetailState,
    [availableDayState.entityId]: availableDayState,
};
const normalizedPhase4Available = normalizeTodayTrendV2Candidate(phase4Available);
assert.equal(normalizedPhase4Available.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].lifecycle, 'active',
    'event lifecycle 必须独立保持 active/archived 语义');
assert.equal(normalizedPhase4Available.globalEnvelope.payload.scopes.chat.payload.removableEntityStateById['detail:service:4'].state, 'available',
    'removable entity lifecycle 必须独立接受 available 正文闭环');
const phase4IsolationInput = structuredClone(phase4Available);
const phase4IsolationResult = normalizeTodayTrendV2Candidate(phase4IsolationInput);
phase4IsolationInput.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service[0].text = '归一化后篡改输入 detail';
phase4IsolationInput.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages[0].summary = '归一化后篡改输入 day summary';
assert.equal(phase4IsolationResult.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service[0].text,
    '完成阶段详情', 'v2 candidate 归一化结果中的 detail 必须与调用方输入隔离');
assert.equal(phase4IsolationResult.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages[0].summary,
    '完成仓门修复', 'v2 candidate 归一化结果中的 day-summary 不得被调用方后续修改污染');
const phase4DetailExtra = structuredClone(phase4Available);
phase4DetailExtra.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service[0].debug = true;
assert.throws(() => normalizeTodayTrendV2Candidate(phase4DetailExtra), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'stage detail 额外字段必须被 closed-set 拒绝');
const phase4DetailMissing = structuredClone(phase4Available);
delete phase4DetailMissing.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service[0].text;
assert.throws(() => normalizeTodayTrendV2Candidate(phase4DetailMissing), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'stage detail 缺少正文必须被拒绝');
const phase4DetailWrongType = structuredClone(phase4Available);
phase4DetailWrongType.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service[0].storyDate = 20250415;
assert.throws(() => normalizeTodayTrendV2Candidate(phase4DetailWrongType), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'stage detail storyDate 类型错误必须被拒绝');

const phase4Manifest = structuredClone(migratedValidV2);
const phase4ManifestPayload = phase4Manifest.globalEnvelope.payload.scopes.chat.payload;
const manifestId = 'manifest:rumor:1';
const availableManifestState = {
    entityType: 'manifest', entityId: manifestId, eventId: 'rumor', state: 'available',
    removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
};
phase4ManifestPayload.archivedRemovableDataByEvent.rumor = {
    daySummariesById: {}, manifestsById: { [manifestId]: { id: manifestId } },
};
phase4ManifestPayload.removableEntityStateById = { [manifestId]: availableManifestState };
const normalizedPhase4Manifest = normalizeTodayTrendV2Candidate(phase4Manifest);
assert.deepEqual(normalizedPhase4Manifest.globalEnvelope.payload.scopes.chat.payload
    .archivedRemovableDataByEvent.rumor.manifestsById[manifestId], { id: manifestId },
    'manifest 最小 closed-set 与 available lifecycle 必须形成正文闭环');
const phase4ManifestIsolationInput = structuredClone(phase4Manifest);
const phase4ManifestIsolationResult = normalizeTodayTrendV2Candidate(phase4ManifestIsolationInput);
phase4ManifestIsolationInput.globalEnvelope.payload.scopes.chat.payload.archivedRemovableDataByEvent
    .rumor.manifestsById[manifestId].id = 'manifest:rumor:2';
assert.equal(phase4ManifestIsolationResult.globalEnvelope.payload.scopes.chat.payload.archivedRemovableDataByEvent
    .rumor.manifestsById[manifestId].id, manifestId,
    'v2 candidate 归一化结果中的 manifest 必须与调用方输入隔离');
const phase4ManifestExtra = structuredClone(phase4Manifest);
phase4ManifestExtra.globalEnvelope.payload.scopes.chat.payload.archivedRemovableDataByEvent
    .rumor.manifestsById[manifestId].debug = true;
assert.throws(() => normalizeTodayTrendV2Candidate(phase4ManifestExtra), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'manifest 额外字段必须被 closed-set 拒绝');
const phase4ManifestMissing = structuredClone(phase4Manifest);
delete phase4ManifestMissing.globalEnvelope.payload.scopes.chat.payload.archivedRemovableDataByEvent
    .rumor.manifestsById[manifestId].id;
assert.throws(() => normalizeTodayTrendV2Candidate(phase4ManifestMissing), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'manifest 缺少 id 必须被拒绝');
const phase4ManifestBadRevision = structuredClone(phase4Manifest);
const invalidManifestId = 'manifest:rumor:0';
phase4ManifestBadRevision.globalEnvelope.payload.scopes.chat.payload.archivedRemovableDataByEvent
    .rumor.manifestsById = { [invalidManifestId]: { id: invalidManifestId } };
phase4ManifestBadRevision.globalEnvelope.payload.scopes.chat.payload.removableEntityStateById = {
    [invalidManifestId]: { ...availableManifestState, entityId: invalidManifestId },
};
assert.throws(() => normalizeTodayTrendV2Candidate(phase4ManifestBadRevision), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'manifest snapshot revision 必须是大于等于 1 的安全整数');

const phase4Removed = structuredClone(migratedValidV2);
const phase4RemovedPayload = phase4Removed.globalEnvelope.payload.scopes.chat.payload;
const phase4RemovedEvent = phase4RemovedPayload.dynamics.active[0];
const removedDayId = 'day:service:2025-04-15';
const removedDayState = {
    entityType: 'day-summary', entityId: removedDayId, eventId: 'service', state: 'removed',
    removalReason: 'archived-retention', removedAtAssistantCount: 52, policyRevision: 1,
};
phase4RemovedEvent.stages = [
    ...phase4RemovedEvent.stages,
    { ...phase4ProjectionFixtures.period, childSummaryRefs: [removedDayId], sourceStageStart: 3, sourceStageEnd: 4 },
];
phase4RemovedEvent.latestStage = phase4ProjectionFixtures.period.summary;
phase4RemovedPayload.removableEntityStateById = { [removedDayId]: removedDayState };
phase4RemovedPayload.removableEntityTombstonesById = { [removedDayId]: structuredClone(removedDayState) };
const normalizedPhase4Removed = normalizeTodayTrendV2Candidate(phase4Removed);
assert.equal(normalizedPhase4Removed.globalEnvelope.payload.scopes.chat.payload.removableEntityStateById[removedDayId].state, 'removed',
    'soft ref 指向 removed state/tombstone 时必须是合法闭环');

const phase4Unknown = structuredClone(phase4Removed);
const phase4UnknownPayload = phase4Unknown.globalEnvelope.payload.scopes.chat.payload;
phase4UnknownPayload.dynamics.active[0].stages.at(-1).childSummaryRefs = ['day:service:unknown'];
assert.throws(() => normalizeTodayTrendV2Candidate(phase4Unknown), error => error?.code === 'TT_DANGLING_REF_UNKNOWN',
    'soft ref 无正文、state 和 tombstone 时必须抛 TT_DANGLING_REF_UNKNOWN');
const phase4WrongTypeRef = structuredClone(phase4Available);
const phase4WrongTypeEvent = phase4WrongTypeRef.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0];
phase4WrongTypeEvent.stages.push({
    ...phase4ProjectionFixtures.period, childSummaryRefs: ['detail:service:4'], sourceStageStart: 6, sourceStageEnd: 7,
});
phase4WrongTypeEvent.latestStage = phase4ProjectionFixtures.period.summary;
assert.throws(() => normalizeTodayTrendV2Candidate(phase4WrongTypeRef), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'period childSummaryRefs 指向 detail 时必须拒绝类型串线');
const phase4CrossEventRef = structuredClone(phase4Removed);
const phase4CrossEventPayload = phase4CrossEventRef.globalEnvelope.payload.scopes.chat.payload;
const crossEventDayId = 'day:rumor:2025-04-15';
const crossEventRemovedState = {
    entityType: 'day-summary', entityId: crossEventDayId, eventId: 'rumor', state: 'removed',
    removalReason: 'archived-retention', removedAtAssistantCount: 53, policyRevision: 1,
};
phase4CrossEventPayload.removableEntityStateById = { [crossEventDayId]: crossEventRemovedState };
phase4CrossEventPayload.removableEntityTombstonesById = { [crossEventDayId]: structuredClone(crossEventRemovedState) };
phase4CrossEventPayload.dynamics.active[0].stages.at(-1).childSummaryRefs = [crossEventDayId];
assert.throws(() => normalizeTodayTrendV2Candidate(phase4CrossEventRef), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'soft ref 指向其他 event 的合法实体时也必须拒绝跨事件串线');
const phase4InvalidRecordIdentity = structuredClone(phase4Removed);
phase4InvalidRecordIdentity.globalEnvelope.payload.scopes.chat.payload.removableEntityStateById[removedDayId].eventId = 'rumor';
phase4InvalidRecordIdentity.globalEnvelope.payload.scopes.chat.payload.removableEntityTombstonesById[removedDayId].eventId = 'rumor';
assert.throws(() => normalizeTodayTrendV2Candidate(phase4InvalidRecordIdentity), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'removable record 的 ID namespace、entityType 与 eventId 必须一致');
const phase4OrphanRemoved = structuredClone(phase4Removed);
const orphanRemovedId = 'day:missing-event:2025-04-16';
const orphanRemovedState = {
    entityType: 'day-summary', entityId: orphanRemovedId, eventId: 'missing-event', state: 'removed',
    removalReason: 'archived-retention', removedAtAssistantCount: 54, policyRevision: 1,
};
phase4OrphanRemoved.globalEnvelope.payload.scopes.chat.payload.removableEntityStateById = { [orphanRemovedId]: orphanRemovedState };
phase4OrphanRemoved.globalEnvelope.payload.scopes.chat.payload.removableEntityTombstonesById = { [orphanRemovedId]: structuredClone(orphanRemovedState) };
assert.throws(() => normalizeTodayTrendV2Candidate(phase4OrphanRemoved), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'removed state 与 tombstone 即使彼此一致，也不得指向当前 scope 不存在的 event');
const phase4ConflictingBody = structuredClone(phase4Available);
phase4ConflictingBody.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service.push({
    ...phase4ConflictingBody.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service[0], text: '同 ID 的冲突正文',
});
assert.throws(() => normalizeTodayTrendV2Candidate(phase4ConflictingBody), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    '同一 removable entity ID 的不同正文必须拒绝');
const phase4ReorderedBody = structuredClone(phase4Available);
const originalDetail = phase4ReorderedBody.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service[0];
phase4ReorderedBody.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service.push({
    storyDate: originalDetail.storyDate, text: originalDetail.text,
    sourceStageSequence: originalDetail.sourceStageSequence, id: originalDetail.id,
});
assert.doesNotThrow(() => normalizeTodayTrendV2Candidate(phase4ReorderedBody),
    '同一 removable entity ID 的语义相同正文不得因属性插入顺序不同被误判为冲突');
const phase4Overlapping = structuredClone(migratedValidV2);
const phase4OverlappingEvent = phase4Overlapping.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0];
phase4OverlappingEvent.stages[1].sourceStageStart = 1;
assert.throws(() => normalizeTodayTrendV2Candidate(phase4Overlapping), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'StageProjection source 区间重叠必须拒绝');
const phase4LifecycleCollision = structuredClone(migratedValidV2);
phase4LifecycleCollision.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].lifecycle = 'available';
assert.throws(() => normalizeTodayTrendV2Candidate(phase4LifecycleCollision), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'removable lifecycle 名称不得污染 event lifecycle');

const phase4RewrittenBody = structuredClone(normalizedPhase4Available);
phase4RewrittenBody.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent.service[0].text = '改写稳定 ID 正文';
assert.throws(() => validateTodayTrendV2Transition(normalizedPhase4Available, phase4RewrittenBody),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', '跨 candidate 改写稳定 removable entity ID 内容必须拒绝');
const phase4RewrittenProjection = structuredClone(migratedValidV2);
phase4RewrittenProjection.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages[0].text = '同 ID 改写后的投影正文';
assert.throws(() => validateTodayTrendV2Transition(migratedValidV2, phase4RewrittenProjection),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', '跨 candidate 改写任意稳定 StageProjection ID 内容必须拒绝');
const phase4ReorderedProjection = structuredClone(migratedValidV2);
const originalProjection = phase4ReorderedProjection.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages[0];
phase4ReorderedProjection.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages[0] = {
    revision: originalProjection.revision, sourceStageEnd: originalProjection.sourceStageEnd,
    sourceStageStart: originalProjection.sourceStageStart, legacyIndex: originalProjection.legacyIndex,
    text: originalProjection.text, kind: originalProjection.kind, id: originalProjection.id,
};
assert.doesNotThrow(() => validateTodayTrendV2Transition(migratedValidV2, phase4ReorderedProjection),
    '跨 candidate 的语义相同 projection 不得因属性插入顺序不同被误判为改写');
const phase4ChangedFacade = buildReadOnlyShadow(normalizedPhase4Available);
phase4ChangedFacade.scopes.chat.dynamics.active[0].title = '同 ID 的新业务事件';
const phase4ChangedEventCandidate = normalizeTodayTrendV2Candidate(phase4ChangedFacade, normalizedPhase4Available);
const phase4ChangedEventPayload = phase4ChangedEventCandidate.globalEnvelope.payload.scopes.chat.payload;
assert.throws(() => replaceTodayTrendV2ScopeWithInitialization(normalizedPhase4Removed, valid, 'chat', 124),
    error => error?.code === 'TT_INITIALIZATION_REBUILD_BLOCKED',
    '旧 scope 存在 removed lifecycle 与 tombstone 时，受控初始化替换必须整单拒绝');

assert.equal(phase4ChangedEventPayload.stageDetailsByEvent.service, undefined,
    '同 ID 事件的 v1 可见语义变化后不得继承旧 detail 正文');
assert.equal(phase4ChangedEventPayload.removableEntityStateById['detail:service:4'], undefined,
    '同 ID 事件的 v1 可见语义变化后不得继承旧 removable state');
assert.equal(phase4ChangedEventPayload.dynamics.active[0].stages[0].kind, 'legacy-stage',
    '同 ID 事件语义变化后必须按新 facade 重建 projection，不能伪装历史连续');
const phase4DeletedRemovedScope = structuredClone(normalizedPhase4Removed);
delete phase4DeletedRemovedScope.globalEnvelope.payload.scopes.chat;
assert.throws(() => validateTodayTrendV2Transition(normalizedPhase4Removed, phase4DeletedRemovedScope),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', '包含 removed lifecycle 的 scope 不得通过整 scope 删除绕过不可逆门禁');
const phase4Revived = structuredClone(normalizedPhase4Removed);
const phase4RevivedPayload = phase4Revived.globalEnvelope.payload.scopes.chat.payload;
phase4RevivedPayload.dynamics.active[0].stages = [structuredClone(phase4ProjectionFixtures.day), {
    ...phase4ProjectionFixtures.period, childSummaryRefs: [removedDayId], sourceStageStart: 3, sourceStageEnd: 4,
}];
phase4RevivedPayload.dynamics.active[0].latestStage = phase4ProjectionFixtures.period.summary;
phase4RevivedPayload.removableEntityStateById[removedDayId] = structuredClone(availableDayState);
delete phase4RevivedPayload.removableEntityTombstonesById[removedDayId];
assert.throws(() => validateTodayTrendV2Transition(normalizedPhase4Removed, phase4Revived),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', 'removed lifecycle 不得恢复为 available 或删除审计状态');

assert.equal(todayTrendStoreDigest(valid), 'fnv1a32:4a013617:4710', 'v1 digest 必须保持阶段 4 前的稳定基线');
const phase4RevisionVariant = structuredClone(migratedValidV2);
phase4RevisionVariant.globalEnvelope.revision += 100;
for (const envelope of Object.values(phase4RevisionVariant.globalEnvelope.payload.scopes)) envelope.revision += 200;
assert.equal(todayTrendStoreDigest(phase4RevisionVariant), todayTrendStoreDigest(migratedValidV2),
    'v2 digest 必须忽略 global/scope envelope revision');
const phase4BusinessVariant = structuredClone(migratedValidV2);
phase4BusinessVariant.globalEnvelope.payload.scopes.chat.payload.historyRetentionState.detailPoolRevision += 1;
assert.notEqual(todayTrendStoreDigest(phase4BusinessVariant), todayTrendStoreDigest(migratedValidV2),
    'v2 digest 必须感知 v2-only 业务字段变化');

const phase4Harness = createAuthorityHarness();
const phase4CasWrites = [];
const phase4Authority = createTodayTrendV2Authority({
    readEntry: phase4Harness.readEntry,
    compareAndSwap: async request => {
        phase4CasWrites.push(request.writes.map(entry => entry.key));
        return phase4Harness.compareAndSwap(request);
    },
    tabId: 'phase-4-owner', BroadcastChannelImpl: undefined,
});
await phase4Authority.acquire({ readV2: true, writeV2: true, initialStore: valid });
let phase4Now = 8000;
const phase4Journal = createTodayTrendJournal({
    listKeys: async () => [...phase4Harness.records.keys()], readEntry: phase4Harness.readEntry,
    writeEntry: async (key, value) => { phase4Harness.records.set(key, structuredClone(value)); return true; },
    deleteEntry: async key => phase4Harness.records.delete(key), now: () => ++phase4Now,
    transactionId: () => `phase-4-${phase4Now}`,
});
const phase4Storage = createTodayTrendStorage({ v2Authority: phase4Authority, journal: phase4Journal, storage: memoryStorage() });
const phase4Runtime = {};
const phase4Refreshes = [];
const phase4Committer = createTodayTrendCommitter({
    runtime: phase4Runtime, load: phase4Storage.load, loadCanonical: phase4Storage.loadCanonical,
    save: phase4Storage.save, storageStatus: phase4Storage.status, journal: phase4Journal,
    refreshInjection: async store => { phase4Refreshes.push(structuredClone(store)); return { failedWrites: 0, failedKeys: [] }; },
});
const phase4BeforeUnknownStatus = await phase4Authority.status();
const phase4JournalKeysBeforeUnknown = [...phase4Harness.records.keys()].filter(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX));
await assert.rejects(() => phase4Committer.commitScope('chat', payload => {
    const candidate = structuredClone(payload);
    const event = candidate.dynamics.active[0];
    event.stages.push({ ...phase4ProjectionFixtures.period, childSummaryRefs: ['day:service:unknown'], sourceStageStart: 3, sourceStageEnd: 4 });
    event.latestStage = phase4ProjectionFixtures.period.summary;
    return candidate;
}, null, { canonical: true }), error => error?.code === 'TT_DANGLING_REF_UNKNOWN',
    'unknown ref 必须经真实 canonical commitScope 在 journal.begin 与 CAS 前阻断');
const phase4AfterUnknownStatus = await phase4Authority.status();
assert.equal(phase4AfterUnknownStatus.authority.storeRevision, phase4BeforeUnknownStatus.authority.storeRevision,
    'unknown ref 阻断不得递增 committed store revision');
assert.deepEqual(phase4AfterUnknownStatus.authority.scopeRevisionByStorageId,
    phase4BeforeUnknownStatus.authority.scopeRevisionByStorageId, 'unknown ref 阻断不得递增 scope revision');
assert.deepEqual([...phase4Harness.records.keys()].filter(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX)),
    phase4JournalKeysBeforeUnknown, 'unknown ref 阻断不得留下 prepared journal');
assert.equal(phase4Runtime.store, undefined, 'unknown ref 阻断不得污染 runtime facade');

const phase4CasCountBeforeCommit = phase4CasWrites.length;
const phase4Committed = await phase4Committer.commitScope('chat', payload => {
    const candidate = structuredClone(payload);
    const event = candidate.dynamics.active[0];
    event.stages.push({ ...phase4ProjectionFixtures.period, childSummaryRefs: [removedDayId], sourceStageStart: 3, sourceStageEnd: 4 });
    event.latestStage = phase4ProjectionFixtures.period.summary;
    candidate.removableEntityStateById[removedDayId] = structuredClone(removedDayState);
    candidate.removableEntityTombstonesById[removedDayId] = structuredClone(removedDayState);
    return candidate;
}, null, { canonical: true });
const phase4CommittedStatus = await phase4Authority.status();
assert.equal(phase4CommittedStatus.authority.storeRevision, phase4BeforeUnknownStatus.authority.storeRevision + 1,
    '合法 canonical ref/state/tombstone candidate 必须只递增一次 store revision');
assert.equal(phase4CommittedStatus.authority.scopeRevisionByStorageId.chat,
    (phase4BeforeUnknownStatus.authority.scopeRevisionByStorageId.chat || 0) + 1, '合法 canonical scope 提交必须只递增一次对应 scope revision');
assert.ok(phase4CasWrites.slice(phase4CasCountBeforeCommit).some(keys =>
    keys.length === 3 && keys.includes(TODAY_TREND_V2_STORAGE_KEY) && keys.includes(TODAY_TREND_V2_AUTHORITY_KEY)
        && keys.some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX))),
    '合法 canonical candidate、authority 与 store-written journal 必须进入同一 CAS writes');
assert.equal([...phase4Harness.records.keys()].some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX)), false,
    '合法 canonical 提交 accepted 后必须清理终态 journal');
assert.equal(phase4Committed.version, 1, 'canonical commitScope 对调用方必须返回 v1 facade');
assert.equal(phase4Runtime.store.version, 1, 'runtime.store 必须保持 v1 facade，不能泄漏 canonical envelope');
assert.equal(phase4Refreshes.length, 1, '合法 canonical 提交只能刷新一次 facade 注入');
const phase4Persisted = (await phase4Authority.load()).v2Store.globalEnvelope.payload.scopes.chat.payload;
assert.deepEqual(phase4Persisted.removableEntityStateById[removedDayId], removedDayState,
    '合法 removed state 必须随 canonical candidate 持久化');
assert.deepEqual(phase4Persisted.removableEntityTombstonesById[removedDayId], removedDayState,
    '合法 tombstone 必须与 state 在同一 canonical candidate 持久化');
assert.equal(await phase4Authority.release({ readV2: true, serveV2: false }), true,

    '阶段 4 authority harness 必须显式释放 owner');
phase4Authority.close();

const phase5Producer = (eventId, stages, daySummaries = [], periodSummaries = []) => ({
    events: [{ eventId, stages, daySummaries, periodSummaries }],
});
const phase5Stage = text => ({ text, time: null, timeLabel: null });
const phase5GeneratedScope = (store, text) => {
    const scope = structuredClone(buildReadOnlyShadow(store).scopes.chat);
    const event = scope.dynamics.active.find(item => item.id === 'service');
    event.stages.push(text);
    event.latestStage = text;
    return scope;
};
assert.deepEqual(normalizeTodayTrendHistoryProducer({ events: [] }), { events: [] },
    '空 history producer 必须是合法闭集，用于同 envelope 的无历史变化轮次');
for (const time of ['00:00', '23:59']) {
    assert.equal(normalizeTodayTrendHistoryProducer(phase5Producer('service', [{ text: '合法钟点', time, timeLabel: null }]))
        .events[0].stages[0].time, time, `history producer 必须接受合法边界钟点 ${time}`);
}
for (const time of ['24:00', '12:60', '7:30', 'abcde']) {
    assert.throws(() => normalizeTodayTrendHistoryProducer(phase5Producer('service', [{ text: '非法钟点', time, timeLabel: null }])),
        error => error?.code === 'TT_HISTORY_SCHEMA_INVALID', `history producer 必须拒绝非法钟点 ${time}`);
}
assert.throws(() => normalizeTodayTrendHistoryProducer({ events: [], debug: true }),
    error => error?.code === 'TT_HISTORY_SCHEMA_INVALID', 'history producer 顶层额外字段必须整单拒绝');

// Historical batch DTO is a transport adapter; canonical history is produced locally.
const { materializeTodayTrendBatchDelta } = await import('../src/today-trend-batch-delta.js');
const batchEmpty = () => ({ world: { upserts: [] }, reputation: { upserts: [] }, factions: { upserts: [] },
    dynamics: { create: [], appendStages: [], archive: [] }, history: { events: [] } });
const batchBase = buildReadOnlyShadow(migratedValidV2).scopes.chat;
assert.deepEqual(materializeTodayTrendBatchDelta(batchEmpty(), batchBase, 100).parsed.dynamics, batchBase.dynamics);
// S6: world capacity is independent of S4 validation and never mutates its input.
const worldCapacityScope = count => {
    const scope = structuredClone(buildReadOnlyShadow(migratedValidV2).scopes.chat);
    scope.world.items = Array.from({ length: count }, (_, i) => ({ id: `private-world-${i}`, name: '敏感名称标记', summary: '敏感正文标记' }));
    return scope;
};
const worldCapacityError = (existing, added) => error => {
    assert.equal(error.code, 'TT_WORLD_CAPACITY');
    assert.ok(error.message.includes(`现有 ${existing} 项`));
    assert.ok(error.message.includes(`新增 ${added} 项`));
    assert.match(error.message, /上限 24 项.*只能更新已有 ID.*空 world\.upserts=\[\]/);
    assert.doesNotMatch(error.message, /private-world|敏感名称标记|敏感正文标记/);
    for (const key of ['details', 'cause', 'raw']) assert.equal(Object.hasOwn(error, key), false);
    return true;
};
for (const [count, mode, added, rejected] of [
    [22, 'empty', 0, false], [22, 'update', 0, false], [22, 'new', 1, false], [22, 'new', 2, false], [22, 'new', 3, true],
    [23, 'update', 0, false], [23, 'new', 1, false],
    [24, 'empty', 0, false], [24, 'update', 0, false], [24, 'new', 1, true],
    [21, 'new', 1, false], [21, 'update', 0, false], [21, 'new', 3, false], [21, 'new', 4, true],
]) {
    const scope = worldCapacityScope(count);
    const before = structuredClone(scope);
    const dto = batchEmpty();
    dto.world.upserts = mode === 'update' ? [{ ...scope.world.items[0], summary: '更新后的宏观变化' }]
        : Array.from({ length: added }, (_, i) => ({ id: `private-world-new-${i}`, name: '敏感名称标记', summary: '敏感正文标记' }));
    if (rejected) assert.throws(() => materializeTodayTrendBatchDelta(dto, scope, 100), worldCapacityError(count, added));
    else {
        const result = materializeTodayTrendBatchDelta(dto, scope, 100).parsed.world.items;
        assert.equal(result.length, count + added);
        assert.deepEqual(result, mode === 'update' ? [dto.world.upserts[0], ...before.world.items.slice(1)] : [...before.world.items, ...dto.world.upserts]);
    }
    assert.deepEqual(scope, before, '容量矩阵成功或拒绝均不得改写 scope');
}
for (const count of [21, 22, 23, 24]) {
    const scope = worldCapacityScope(count);
    const { systemPrompt } = buildTodayTrendGenerationEnvelope({ context: {}, preset: valid.presets.preset, scope, historyBatch: [] });
    assert.ok(systemPrompt.includes(`当前世界态势 ${count}/24 项`));
    assert.ok(systemPrompt.includes(JSON.stringify(scope.world.items.map(item => item.id))));
    assert.match(systemPrompt, /长期宏观索引.*不是逐批事件日志.*不能复制逐条事件.*禁止为本批凑数/);
    assert.match(systemPrompt, /无法由已有条目覆盖、长期跨事件的宏观变化/);
    assert.match(systemPrompt, /新增后总数不得超过 24 项/);
    assert.doesNotMatch(systemPrompt, /未到 22 项|至少 22 项|近上限硬约束/);
    if (count < 24) {
        assert.match(systemPrompt, /当前未满 24 项，允许基于本批明确事实在容量内新增 ID，不要求凑满/);
        assert.doesNotMatch(systemPrompt, /容量硬约束|禁止新增任何新 ID/);
    } else assert.match(systemPrompt, /容量硬约束.*当前已达到 24 项.*禁止新增任何新 ID.*只允许更新已有 ID 或返回空 world\.upserts=\[\].*仍允许更新已有 ID/);
}
const capacityControllerScope = worldCapacityScope(24);
const capacityControllerBefore = structuredClone(capacityControllerScope);
const capacityControllerDto = batchEmpty();
capacityControllerDto.world.upserts = [{ id: 'private-world-new', name: '敏感名称标记', summary: '敏感正文标记' }];
const capacityController = createTodayTrendGenerationController({ getCtx: () =>({}), gather: async () => ({}),
    buildGeneration: () => ({ systemPrompt: '', userPrompt: '' }), callAI: async () => JSON.stringify(capacityControllerDto), now: () => 100 });
await assert.rejects(() => capacityController.generate({ scope: capacityControllerScope, preset: valid.presets.preset, historyBatch: [] }), worldCapacityError(24, 1));
assert.deepEqual(capacityControllerScope, capacityControllerBefore);
console.log('S6 world capacity: 14 materialize cases, 4 history prompts, generation error passthrough passed');

const batchDto = batchEmpty();
batchDto.dynamics.appendStages.push({ eventId: 'service', stages: ['批量最终进展'] });
batchDto.dynamics.archive.push({ eventId: 'service', outcome: 'resolved', finalResult: '批次完成' });
const batchMaterialized = materializeTodayTrendBatchDelta(batchDto, batchBase, 100);
const batchCandidate = { ...batchBase, ...batchMaterialized.parsed };
delete batchCandidate.history;
batchCandidate.dynamicsSettings = { ...batchCandidate.dynamicsSettings, autoComplete: true, archiveCompleted: true };
const beforeBatch = JSON.stringify(migratedValidV2);
const batchArchived = applyTodayTrendGenerationToV2(migratedValidV2, 'chat', batchCandidate, batchMaterialized.parsed.history,
    { trustedStoryDate: '2025-04-15', assistantCount: 8, generatedAt: 100, archives: batchMaterialized.archives });
const batchArchivedEvent = batchArchived.globalEnvelope.payload.scopes.chat.payload.dynamics.archived.find(event => event.id === 'service');
assert.equal(batchArchivedEvent.stages.at(-1).text, '批量最终进展');
assert.equal(batchArchivedEvent.stages.at(-1).storyDate, '2025-04-15');
assert.equal(batchArchivedEvent.createdAt, batchBase.dynamics.active.find(event => event.id === 'service').createdAt);
assert.equal(JSON.stringify(migratedValidV2), beforeBatch, '候选生成不能半写 canonical 输入');
const archivedScope = buildReadOnlyShadow(batchArchived).scopes.chat;
assert.throws(() => materializeTodayTrendBatchDelta(batchDto, archivedScope, 200), error => {
    assert.equal(error.message, '历史批增量校验失败：2处字段错误，0处检查未执行');
    return error.details.every(detail => detail.expected === 'active-id' && detail.actual === 'external');
});
const duplicateStageDto = batchEmpty();
duplicateStageDto.history.events.push({ eventId: 'service', stages: [], daySummaries: [], periodSummaries: [] });
assert.throws(() => materializeTodayTrendBatchDelta(duplicateStageDto, batchBase, 100), /字段集合/);
const batchController = createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => ({}),
    buildGeneration: () => ({ systemPrompt: '', userPrompt: '' }), callAI: async () => JSON.stringify(batchDto), now: () => 100 });
const batchGenerated = await batchController.generate({ scope: { ...batchBase, dynamicsSettings: batchCandidate.dynamicsSettings }, preset: buildReadOnlyShadow(migratedValidV2).presets[batchBase.presetId],
    historyBatch: [], storyDate: '2025-04-15', allowHistoricalIncidentRecord: true });
assert.deepEqual(batchGenerated.archives, batchDto.dynamics.archive);
assert.equal(batchGenerated.history.events[0].stages[0].text, '批量最终进展');
const batchControllerCanonical = applyTodayTrendGenerationToV2(migratedValidV2, 'chat', batchGenerated.scope,
    batchGenerated.history, { trustedStoryDate: '2025-04-15', assistantCount: 8, generatedAt: 100, archives: batchGenerated.archives });
assert.deepEqual(batchControllerCanonical, batchArchived, '真实生成控制器输出必须落入同一 canonical 结果');
const createBatch = batchEmpty();
const { type, title, stageLabel, origin, participants, relatedEventIds } = batchBase.dynamics.active.find(event => event.id === 'service');
createBatch.dynamics.create.push({ id: 'batch-new', type, title, stageLabel, origin, participants,
    relatedEventIds, initialStage: '新事件开始' });
createBatch.dynamics.appendStages.push({ eventId: 'batch-new', stages: ['新事件继续', '新事件结束'] });
createBatch.dynamics.archive.push({ eventId: 'batch-new', outcome: 'resolved', finalResult: '同批完成' });
const createController = createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => ({}),
    buildGeneration: () => ({ systemPrompt: '', userPrompt: '' }), callAI: async () => JSON.stringify(createBatch), now: () => 100 });
const createInput = { scope: { ...batchBase, dynamicsSettings: batchCandidate.dynamicsSettings },
    preset: buildReadOnlyShadow(migratedValidV2).presets[batchBase.presetId], historyBatch: [], storyDate: '2025-04-15', allowHistoricalIncidentRecord: true };
const createdBatch = await createController.generate(createInput);
const createdCanonical = applyTodayTrendGenerationToV2(migratedValidV2, 'chat', createdBatch.scope, createdBatch.history,
    { trustedStoryDate: '2025-04-15', assistantCount: 8, generatedAt: 100, archives: createdBatch.archives });
const newlyArchived = createdCanonical.globalEnvelope.payload.scopes.chat.payload.dynamics.archived.find(event => event.id === 'batch-new');
assert.deepEqual(newlyArchived.stages.map(stage => stage.text), ['新事件开始', '新事件继续', '新事件结束']);
assert.equal(newlyArchived.stages.every(stage => stage.storyDate === '2025-04-15'), true);
assert.equal(Object.hasOwn(newlyArchived, 'initialStage'), false, '传输字段不能持久化');
const multiCreateDto = batchEmpty();
for (const id of ['batch-multi-a', 'batch-multi-b']) {
    multiCreateDto.dynamics.create.push({ ...createBatch.dynamics.create[0], id, relatedEventIds: [], initialStage: `${id}开始` });
    multiCreateDto.dynamics.appendStages.push({ eventId: id, stages: [`${id}调查`, `${id}核实`] });
}
multiCreateDto.dynamics.appendStages.push({ eventId: 'service', stages: ['旧事件本批新增进展'] });
let multiCreateCalls = 0;
const multiCreateController = createTodayTrendGenerationController({ getCtx: () => ({}),
    gather: async () => ({ source: { includeExistingChat: false } }), now: () => 100,
    callAI: async (system, user) => {
        multiCreateCalls++;
        assert.ok(system.includes(todayTrendTitleNamingGuide()));
        assert.match(user, /本轮优先事实输入/);
        assert.doesNotMatch(user, /世界书独立推演模式/);
        return JSON.stringify(multiCreateDto);
    } });
const multiInputBefore = JSON.stringify(createInput);
const multiGenerated = await multiCreateController.generate({ ...createInput,
    historyBatch: [{ role: 'assistant', content: '两个事件先后开始、调查并核实；旧事件有新进展。' }] });
assert.equal(multiCreateCalls, 1);
assert.equal(JSON.stringify(createInput), multiInputBefore);
const multiCanonical = applyTodayTrendGenerationToV2(migratedValidV2, 'chat', multiGenerated.scope, multiGenerated.history,
    { trustedStoryDate: '2025-04-15', assistantCount: 8, generatedAt: 100, archives: multiGenerated.archives });
const multiPayload = multiCanonical.globalEnvelope.payload.scopes.chat.payload;
for (const id of ['batch-multi-a', 'batch-multi-b']) {
    const expected = [`${id}开始`, `${id}调查`, `${id}核实`];
    const event = multiPayload.dynamics.active.find(event => event.id === id);
    assert.deepEqual(event.stages.map(stage => stage.text), expected);
    assert.equal(event.latestStage, expected.at(-1));
    assert.equal(event.createdAt, 100);
    assert.equal(event.updatedAt, 100);
    assert.equal(event.stages.every(stage => stage.storyDate === '2025-04-15'), true);
    assert.equal(event.stages.every(stage => stage.sourceFloorStart === 8 && stage.sourceFloorEnd === 8), true);
    assert.deepEqual(event.stages.map(stage => stage.sourceStageStart), [1, 2, 3]);
    assert.deepEqual(event.stages.map(stage => stage.sourceStageEnd), [1, 2, 3]);
    assert.deepEqual(multiGenerated.history.events.find(event => event.eventId === id).stages,
        expected.map(text => ({ text, time: null, timeLabel: null })));
}
assert.deepEqual(multiPayload.dynamics.active.find(event => event.id === 'service').stages.slice(0, -1),
    migratedValidV2.globalEnvelope.payload.scopes.chat.payload.dynamics.active.find(event => event.id === 'service').stages);
assert.deepEqual(multiPayload.dynamics.archived, migratedValidV2.globalEnvelope.payload.scopes.chat.payload.dynamics.archived);
assert.equal(JSON.stringify(migratedValidV2), beforeBatch);


{
// Prevent partial faction replacement/data loss and empty-world bootstrap regressions.
// Existing tests covered event deltas, not complete faction input or world initialization.
// Retire these fixtures only if the batch transport and its replacement semantics are removed.
const factionFixture = (id, parentId = null) => ({ id, name: id, summary: '资料', parentId,
    relatedFactionIds: [], details: [{ label: '职责', value: '巡航' }], relation: { status: 'neutral', evaluation: '暂无交互' } });
const factionBase = { ...createInput.scope, factions: [factionFixture('old')] };
const factionRequest = async (factions, scope = factionBase) => createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => ({}), now: () => 100,
    callAI: async () => JSON.stringify({ ...batchEmpty(), factions }),
}).generate({ ...createInput, scope });
assert.equal(materializeTodayTrendBatchDelta({ ...batchEmpty(), factions: null }, factionBase, 100).parsed.factions, null);
assert.deepEqual((await factionRequest(null)).scope.factions, factionBase.factions);
const replacement = [factionFixture('child', 'parent'), { ...factionFixture('old'), summary: '已更新资料' }, factionFixture('parent')];
assert.deepEqual((await factionRequest(replacement)).scope.factions, replacement);
await assert.rejects(() => factionRequest(replacement.filter(item => item.id !== 'old')), /缺失旧 ID/);
await assert.rejects(() => factionRequest([factionFixture('old', 'missing')]), /factions\[0\].parentId.*父势力不存在/);
for (const details of [null, {}, 'text']) {
    await assert.rejects(() => factionRequest([{ ...factionFixture('old'), details }]), /factions\[0\].details.*expected array/);
}
await assert.rejects(() => factionRequest([factionFixture('old', 'old')]), /自身|循环/);
assert.deepEqual((await factionRequest({ upserts: [] })).scope.factions, factionBase.factions);
assert.deepEqual((await factionRequest({ upserts: [factionFixture('child', 'old')] })).scope.factions,
    [...factionBase.factions, factionFixture('child', 'old')]);
await assert.rejects(() => factionRequest({ upserts: [factionFixture('child', 'missing')] }), /parentId.*父势力不存在/);
// S3 M4: first-error contract through the real controller/materializer, never raw values.
const m4Secret = 'PRIVATE-ID-NAME-秘密';
const m4Cases = [
    [{ ...factionFixture('old'), details: {} }, 'details', 'array', 'object', /details.*expected array/],
    [Object.fromEntries(Object.entries(factionFixture('old')).filter(([key]) => key !== 'parentId')), 'parentId', 'exact-fields', 'missing', /字段集合/],
    [factionFixture('old', m4Secret), 'parentId', 'internal-id-or-null', 'external', /parentId.*父势力不存在/],
    [factionFixture('old', 'old'), 'parentId', 'non-self-id', 'self', /自身|循环/],
    [{ ...factionFixture('old'), relatedFactionIds: [m4Secret] }, 'relatedFactionIds', 'internal-id', 'external', /外部关联势力不存在/],
    [{ ...factionFixture('old'), relatedFactionIds: ['old'] }, 'relatedFactionIds', 'non-self-non-parent-child-id', 'self', /禁止自指或直接父子/],
    [{ ...factionFixture('old'), relatedFactionIds: ['child'] }, 'relatedFactionIds', 'non-self-non-parent-child-id', 'parent-child', /禁止自指或直接父子/],
    [factionFixture(` ${m4Secret} `), 'id', 'unique-id', 'invalid-id', /ID 无效或重复/],
];
const m4Assert = (error, detail, message) => {
    assert.equal(error.code, 'TT_BATCH_VALIDATION');
    assert.deepEqual(error.details, Array.isArray(detail) ? detail : [detail]);
    for (const entry of error.details) {
        assert.deepEqual(Reflect.ownKeys(entry).sort(), ['actual', 'expected', 'object', 'path']);
        assert.equal(Object.isFrozen(entry), true);
    }
    assert.deepEqual(Object.keys(error.details[0]).sort(), ['actual', 'expected', 'object', 'path']);
    assert.equal(Object.isFrozen(error.details), true);
    assert.equal(Object.isFrozen(error.details[0]), true);
    assert.equal(JSON.stringify(error.details).includes(m4Secret), false);
    assert.equal(error.message.includes(m4Secret), false);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.match(error.message, message);
    return true;
};
for (const [item, field, expected, actual, message] of m4Cases) {
    item.name = m4Secret;
    const detail = { object: 'factions[0]', path: `factions[0].${field}`, expected, actual };
    const skipped = (object, path, expected) => ({ object, path, expected, actual: 'unchecked' });
    const expectedDetails = [detail];
    if (field === 'details') expectedDetails.push(skipped('factions[0].details[0]', 'factions[0].details[0]', 'exact-fields'));
    if (actual === 'missing') expectedDetails.push(
        skipped('factions[0]', 'factions[0].details', 'array'),
        skipped('factions[0].relation', 'factions[0].relation', 'exact-fields'),
        skipped('factions[0]', 'factions[0].parentId', 'internal-id-or-null'),
        skipped('factions[0]', 'factions[0].relatedFactionIds', 'internal-id'),
        skipped('factions[1]', 'factions[1].parentId', 'internal-id-or-null'),
        skipped('factions[1]', 'factions[1].relatedFactionIds', 'internal-id'),
    );
    if (actual === 'invalid-id') expectedDetails.push(
        skipped('factions', 'factions', 'complete-id-set'),
        skipped('factions[0]', 'factions[0].parentId', 'internal-id-or-null'),
        skipped('factions[0]', 'factions[0].relatedFactionIds', 'internal-id'),
        skipped('factions[1]', 'factions[1].parentId', 'internal-id-or-null'),
        skipped('factions[1]', 'factions[1].relatedFactionIds', 'internal-id'),
    );
    await assert.rejects(() => factionRequest([item, factionFixture('child', 'old')]), error => m4Assert(error,
        expectedDetails, message));
}
const m4Controller = payload => createTodayTrendGenerationController({ getCtx:() => ({}), gather: async () => ({}),
    now: () => 100, callAI: async () => JSON.stringify(payload) });
// S4 M5: real controller -> materializer, with independent errors and blocked checks.
const m5Dto = batchEmpty();
m5Dto.factions = [{ ...factionFixture('old'), name: m4Secret, details: {} }];
m5Dto.dynamics.create = [{ ...createBatch.dynamics.create[0], id: m4Secret, initialStage: m4Secret.repeat(30) }];
m5Dto.dynamics.archive = [{ eventId: 'unknown-active', outcome: 'resolved', finalResult: m4Secret }];
const m5Details = [
    { object: 'factions[0]', path: 'factions[0].details', expected: 'array', actual: 'object' },
    { object: 'factions[0].details[0]', path: 'factions[0].details[0]', expected: 'exact-fields', actual: 'unchecked' },
    { object: 'dynamics.create[0]', path: 'dynamics.create[0].initialStage', expected: 'non-empty-string-max-240', actual: 'out-of-range-length' },
    { object: 'dynamics.archive[0]', path: 'dynamics.archive[0].eventId', expected: 'active-id', actual: 'external' },
];
const m5Before = JSON.stringify(factionBase);
await assert.rejects(() => m4Controller(m5Dto).generate({ ...createInput, scope: factionBase }), error => {
    m4Assert(error, m5Details, /^历史批增量校验失败：3处字段错误，1处检查未执行$/);
    return true;
});
assert.equal(JSON.stringify(factionBase), m5Before);
const m5Dependency = batchEmpty();
m5Dependency.dynamics.create = null;
m5Dependency.dynamics.appendStages = [{ eventId: m4Secret, stages: ['有效阶段'] }];
m5Dependency.dynamics.archive = [{ eventId: m4Secret, outcome: 'resolved', finalResult: m4Secret }];
m5Dependency.history.events = [{ eventId: m4Secret, daySummaries: [], periodSummaries: [] }];
await assert.rejects(() => m4Controller(m5Dependency).generate(createInput), error => m4Assert(error, [
    { object: 'dynamics.create', path: 'dynamics.create', expected: 'array', actual: 'null' },
    { object: 'dynamics.appendStages[0]', path: 'dynamics.appendStages[0].eventId', expected: 'active-id', actual: 'unchecked' },
    { object: 'dynamics.archive[0]', path: 'dynamics.archive[0].eventId', expected: 'active-id', actual: 'unchecked' },
    { object: 'history.events[0]', path: 'history.events[0].eventId', expected: 'active-id', actual: 'unchecked' },
], /dynamics.create.*必须为数组/));
let m5Commits = 0;
let m5Fail = true;
let m5Store = structuredClone(valid);
const m5StoreBefore = JSON.stringify(m5Store);
const m5Scheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => m5Fail
        ? m4Controller(m5Dto).generate({ ...createInput, scope: factionBase }) : { scope } },
    committer: { invalidateCommits() {}, commitStore: async update => { m5Commits++; m5Store = update(m5Store); return m5Store; } },
    getStore: async () => m5Store, getStorageId: () => 'chat', getChat: () => [{ mes: m4Secret }], getFloor: () => 2, now: () => 100,
});
for (const clear of [() => m5Scheduler.cancel(), () => m5Scheduler.acknowledge()]) {
    await assert.rejects(() => m5Scheduler.manual(), /历史批增量校验失败：3处字段错误，1处检查未执行/);
    const state = m5Scheduler.state();
    assert.deepEqual(state.lastErrorDetails, { code: 'TT_BATCH_VALIDATION', details: m5Details });
    assert.equal(Object.isFrozen(state.lastErrorDetails), true);
    assert.equal(Object.isFrozen(state.lastErrorDetails.details), true);
    assert.equal(state.lastErrorDetails.details.every(Object.isFrozen), true);
    assert.equal(JSON.stringify(state).includes(m4Secret), false);
    assert.equal(m5Commits, 0);
    assert.equal(JSON.stringify(m5Store), m5StoreBefore);
    assert.equal(JSON.stringify(factionBase), m5Before);
    clear();
    assert.equal(m5Scheduler.state().lastErrorDetails, null);
}
await assert.rejects(() => m5Scheduler.manual(), /历史批增量校验失败/);
m5Fail = false;
await m5Scheduler.manual();
assert.equal(m5Scheduler.state().lastErrorDetails, null);
assert.equal(m5Scheduler.state().lastError, null);
for (const count of [2, 20]) {
    const details = Array.from({ length: count }, () => ({ ...m5Details[0] }));
    const scheduler = createTodayTrendScheduler({
        controller: { generate: async () => { throw Object.assign(new Error('safe failure'), { code: 'TT_BATCH_VALIDATION', details }); } },
        committer: { invalidateCommits() {}, commitStore: async () => assert.fail('must not commit') },
        getStore: async () => structuredClone(valid), getStorageId: () => 'chat', getChat: () => [{ mes: '正文' }], getFloor: () => 2,
    });
    await assert.rejects(() => scheduler.manual(), /safe failure/);
    const safe = scheduler.state().lastErrorDetails;
    assert.deepEqual(safe.details, details);
    assert.equal(Object.isFrozen(safe), true);
    assert.equal(Object.isFrozen(safe.details), true);
    assert.equal(safe.details.every(Object.isFrozen), true);
    assert.notEqual(safe.details[0], details[0]);
    details[0].actual = m4Secret;
    assert.equal(safe.details[0].actual, 'object');
}
await assert.rejects(() => m4Controller({ ...batchEmpty(), unexpected: m4Secret }).generate(createInput), error => m4Assert(error,
    { object: '$', path: '$', expected: 'exact-fields', actual: 'object' }, /字段集合/));
const m4LongStage = batchEmpty();
m4LongStage.dynamics.create = [{ id: m4Secret, type: 'normal', title: m4Secret, stageLabel: '阶段', origin: '来源',
    participants: [], initialStage: '长'.repeat(241), relatedEventIds: [] }];
await assert.rejects(() => m4Controller(m4LongStage).generate(createInput), error => m4Assert(error,
    { object: 'dynamics.create[0]', path: 'dynamics.create[0].initialStage', expected: 'non-empty-string-max-240', actual: 'out-of-range-length' }, /最多240字/));
let m4Failure = true;
let m4Store = structuredClone(valid);
let m4Commits = 0;
const m4Scheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => m4Failure
        ? m4Controller({ ...batchEmpty(), factions: [{ ...factionFixture('old'), details: {} }] }).generate({ ...createInput, scope: factionBase })
        : { scope } },
    committer: { invalidateCommits() {}, commitStore: async update => { m4Commits += 1; m4Store = update(m4Store); return m4Store; } },
    getStore: async () => m4Store, getStorageId: () => 'chat', getChat: () => [{ mes: '正文' }], getFloor: () => 2, now: () => 100,
});
await assert.rejects(() => m4Scheduler.manual(), /details.*expected array/);
assert.equal(m4Commits, 0);
assert.equal(typeof m4Scheduler.state().lastError, 'string');
assert.deepEqual(m4Scheduler.state().lastErrorDetails, { code: 'TT_BATCH_VALIDATION', details: [
    { object: 'factions[0]', path: 'factions[0].details', expected: 'array', actual: 'object' },
    { object: 'factions[0].details[0]', path: 'factions[0].details[0]', expected: 'exact-fields', actual: 'unchecked' },
] });
m4Scheduler.cancel();
assert.equal(m4Scheduler.state().lastErrorDetails, null);
await assert.rejects(() => m4Scheduler.manual(), /details.*expected array/);
assert.notEqual(m4Scheduler.state().lastErrorDetails, null);
m4Failure = false;
await m4Scheduler.manual();
assert.equal(m4Scheduler.state().lastErrorDetails, null);
assert.equal(m4Scheduler.state().lastError, null);
const m4SafeDetail = { object: 'factions[0]', path: 'factions[0].details', expected: 'array', actual: 'object' };
for (const [code, details] of [
    ['TT_BATCH_VALIDATION_EXTRA', [m4SafeDetail]],
    ['TT_BATCH_VALIDATION', [{ ...m4SafeDetail, raw: m4Secret }]],
    ['TT_BATCH_VALIDATION', [{ ...m4SafeDetail, object: m4Secret }]],
    ['TT_BATCH_VALIDATION', [{ ...m4SafeDetail, path: `factions[${m4Secret}].details` }]],
    ['TT_BATCH_VALIDATION', [{ ...m4SafeDetail, actual: m4Secret }]],
    ['TT_BATCH_VALIDATION', [{ ...m4SafeDetail, expected: m4Secret }]],
    ['TT_BATCH_VALIDATION', Array(21).fill(m4SafeDetail)],
    ['TT_BATCH_VALIDATION', []],
]) {
    const rejectedDetailsScheduler = createTodayTrendScheduler({
        controller: { generate: async () => { throw Object.assign(new Error('safe failure'), { code, details }); } },
        committer: { invalidateCommits() {}, commitStore: async () => { assert.fail('invalid candidate must not commit'); } },
        getStore: async () => structuredClone(valid), getStorageId: () => 'chat',
        getChat: () => [{ mes: '正文' }], getFloor: () => 2, now: () => 100,
    });
    await assert.rejects(() => rejectedDetailsScheduler.manual(), /safe failure/);
    assert.equal(rejectedDetailsScheduler.state().lastError, 'safe failure');
    assert.equal(rejectedDetailsScheduler.state().lastErrorDetails, null);
    assert.equal(JSON.stringify(rejectedDetailsScheduler.state()).includes(m4Secret), false);
    rejectedDetailsScheduler.acknowledge();
    assert.equal(rejectedDetailsScheduler.state().lastErrorDetails, null);
}

const completeFactions = Array.from({ length: 40 }, (_, i) => ({ ...factionFixture(`node-${i}`, i === 0 ? 'node-39' : null),
    details: [{ label: '完整资料', value: '长'.repeat(400) + (i === 39 ? '末尾父势力资料<&>' : '') }] }));
const decodeBlock = (prompt, name) => JSON.parse(JSON.parse(prompt.match(new RegExp(`<${name} encoding="json-string">\\n(.*?)\\n</${name}>`, 's'))[1]));
for (const includeExistingChat of [true, false]) {
    const largeCanonical = structuredClone(migratedValidV2);
    largeCanonical.globalEnvelope.payload.scopes.chat.payload.factions = completeFactions;
    const projection = serializeTodayTrendV2ScopeForGeneration(largeCanonical, 'chat');
    assert.ok(JSON.parse(projection).factions.length < completeFactions.length, 'fixture must exercise original truncation');
    const envelope = buildTodayTrendGenerationEnvelope({ ...createInput, scope: { ...createInput.scope, factions: completeFactions },
        promptScope: projection, context: { source: { includeExistingChat } } });
    assert.deepEqual(decodeBlock(envelope.userPrompt, 'current_factions'), completeFactions);
    assert.equal(Object.hasOwn(decodeBlock(envelope.userPrompt, 'current_today_trend'), 'factions'), false);
    assert.match(envelope.systemPrompt, /空模块从本批历史事实建立初始 world/);
    assert.match(envelope.systemPrompt, /禁止回填较晚事实/);
    assert.match(envelope.userPrompt, /world_items_schema/);
    const example = JSON.parse(envelope.systemPrompt.split('\n').find(line => line.startsWith('{"factions"')));
    assert.deepEqual((await factionRequest(example.factions, { ...factionBase, factions: [] })).scope.factions, example.factions);
    assert.equal(decodeBlock(envelope.userPrompt, 'current_factions').at(-1).details[0].value.endsWith('末尾父势力资料<&>'), true);
    assert.doesNotMatch(envelope.userPrompt, /仅补充 history|本次仅更新/);
}
// Raw canonical JSON budget must not be consumed a second time by safe transport escaping.
for (const suffix of ['', '"\\<>&']) {
    const canonical = structuredClone(migratedValidV2);
    const payload = canonical.globalEnvelope.payload.scopes.chat.payload;
    payload.world = { items: Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, name: '态势', summary: '汉'.repeat(555) })) };
    payload.world.items[19].summary += suffix;
    payload.factions = [];
    payload.reputation = { circles: [] };
    payload.dynamics = { active: [], archived: [] };
    // This isolated empty-event fixture must not retain the migrated archived baseline.
    payload.fixedCoreBaselineByEvent = {};
    const projection = serializeTodayTrendV2ScopeForGeneration(canonical, 'chat');
    const { factions, ...other } = JSON.parse(projection);
    const raw = JSON.stringify(other);
    if (!suffix) {
        assert.equal(projection.length, 11952);
        assert.equal(raw.length, 11938);
        assert.equal(JSON.stringify(raw).length, 12194);
    }
    assert.deepEqual(other.world, payload.world);
    const scope = buildReadOnlyShadow(canonical).scopes.chat;
    assert.deepEqual(scope.factions, payload.factions);
    const envelope = buildTodayTrendGenerationEnvelope({ ...createInput, scope, promptScope: projection, context: {} });
    assert.deepEqual(decodeBlock(envelope.userPrompt, 'current_today_trend'), other);
    assert.deepEqual(decodeBlock(envelope.userPrompt, 'current_factions'), factions);
    const encoded = envelope.userPrompt.match(/<current_today_trend encoding="json-string">\n(.*?)\n<\/current_today_trend>/s)[1];
    assert.doesNotMatch(encoded, /[<>&]/);
    assert.ok(encoded.length <= 6 * raw.length + 2);
    // Exercise the actual remaining-content cap exactly, then one raw code unit over.
    other.world.items[19].summary += '汉'.repeat(12000 - raw.length);
    assert.equal(JSON.stringify(other).length, 12000);
    const boundary = buildTodayTrendGenerationEnvelope({ ...createInput, scope, promptScope: JSON.stringify(other), context: {} });
    assert.deepEqual(decodeBlock(boundary.userPrompt, 'current_today_trend'), other);
    other.world.items[19].summary += '汉';
    assert.throws(() => buildTodayTrendGenerationEnvelope({ ...createInput, scope, promptScope: JSON.stringify(other), context: {} }),
        /current_today_trend.*12000.*原始 JSON.*拒绝截断/);
}
const facadeCanonical = structuredClone(migratedValidV2);
facadeCanonical.globalEnvelope.payload.scopes.chat.payload.factions = completeFactions;
assert.deepEqual(buildReadOnlyShadow(facadeCanonical).scopes.chat.factions, completeFactions,
    'scopeFacadeFields must preserve every faction field, including trailing details and parent references');
const capFaction = factionFixture('cap');
capFaction.summary = '<>&"\\';
capFaction.summary += '汉'.repeat(240000 - JSON.stringify([capFaction]).length);
const capScope = { ...createInput.scope, factions: [capFaction] };
assert.equal(JSON.stringify(capScope.factions).length, 240000);
assert.deepEqual(decodeBlock(buildTodayTrendGenerationEnvelope({ ...createInput, scope: capScope, context: {} }).userPrompt, 'current_factions'), capScope.factions);
capFaction.summary += '汉';
assert.throws(() => buildTodayTrendGenerationEnvelope({ ...createInput, scope: capScope, context: {} }), /current_factions.*240000.*原始 JSON.*拒绝截断/);
assert.throws(() => buildTodayTrendGenerationEnvelope({ ...createInput, context: {},
    scope: { ...createInput.scope, factions: [{ ...factionFixture('huge'), summary: 'x'.repeat(240001) }] } }), /current_factions.*拒绝截断/);
assert.throws(() => buildTodayTrendGenerationEnvelope({ ...createInput, context: {}, promptScope: '{broken' }), SyntaxError);
assert.throws(() => buildTodayTrendGenerationEnvelope({ ...createInput, context: {},
    promptScope: JSON.stringify({ world: { items: [{ summary: 'x'.repeat(12001) }] } }) }), /current_today_trend.*拒绝截断/);
const worldReset = replaceTodayTrendV2ScopeWithBatchReset(batchReadyValidV2, 'chat', 100);
const worldEmptyScope = buildReadOnlyShadow(worldReset).scopes.chat;
assert.deepEqual(worldEmptyScope.world.items, []);
const worldInitial = { id: 'regional-shipping', name: '区域航运', summary: '本批公告确认区域航运恢复。' };
const worldController = createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => ({}), now: () => 101,
    callAI: async (system) => { assert.match(system, /空模块从本批历史事实建立初始 world/);
        return JSON.stringify({ ...batchEmpty(), factions: null, world: { upserts: [worldInitial] } }); } });
const worldGenerated = await worldController.generate({ ...createInput, scope: worldEmptyScope,
    historyBatch: [{ role: 'assistant', content: '港务公告确认区域航运恢复。' }] });
const worldCanonical = applyTodayTrendGenerationToV2(worldReset, 'chat', worldGenerated.scope, worldGenerated.history,
    { trustedStoryDate: '2025-04-15', assistantCount: 1, generatedAt: 101, archives: worldGenerated.archives });
const worldUiScope = resolveTodayTrendV2UiScope(worldCanonical, 'chat');
assert.deepEqual(worldUiScope.world.items, [worldInitial]);
assert.match(renderTodayTrendWorldView({ scope: worldUiScope }), /区域航运/);
assert.deepEqual(materializeTodayTrendBatchDelta(batchEmpty(), worldGenerated.scope, 102).parsed.world.items, [worldInitial]);
assert.deepEqual(materializeTodayTrendBatchDelta(batchEmpty(), worldEmptyScope, 102).parsed.world.items, []);
}


// Exercise the actual prompt (including its executable DTO example), not source grep.
for (const includeExistingChat of [true, false]) {
    for (const historyBatch of [null, [], [{ role: 'assistant', content: '本批事实标记' }]]) {
        const envelope = buildTodayTrendGenerationEnvelope({ ...createInput, historyBatch,
            context: { source: { includeExistingChat }, mainChatText: '普通正文标记', latestChatText: '较晚正文标记' } });
        assert.ok(envelope.systemPrompt.includes(todayTrendTitleNamingGuide()));
        for (const instruction of ['不要为了填满字段而编造变化', '真实新增进展', '不改写或截短旧历史', '遵守本轮有效的模块规则', '不能替代阶段']) {
            assert.ok(envelope.systemPrompt.includes(instruction), instruction);
        }
        const mode = JSON.parse(envelope.userPrompt.match(/<generation_mode encoding="json-string">\n(.*?)\n<\/generation_mode>/s)[1]);
        if (Array.isArray(historyBatch)) {
            assert.match(mode, /history_batch_data 是本轮优先事实输入/);
            assert.doesNotMatch(envelope.userPrompt, /独立推演模式|聊天正文未作为|普通正文标记|较晚正文标记/);
            assert.match(envelope.userPrompt, /factions 无变化为 null/);
            assert.doesNotMatch(envelope.systemPrompt, /完整替换值|dynamics 非 null|latestStage 必须等于|顶层只能有 preset 和 scope/);
            assert.match(envelope.systemPrompt, /多个新建事件都可分别这样表达/);
            assert.match(envelope.systemPrompt, /旧241–600字阶段只读保留/);
            if (historyBatch.length) assert.match(envelope.userPrompt, /本批事实标记/);
            const example = JSON.parse(envelope.systemPrompt.split('\n').find(line => line.startsWith('{"world"')));
            const materialized = materializeTodayTrendBatchDelta(example, batchBase, 100);
            assert.equal(materialized.parsed.dynamics.active.at(-1).stages.length, 3);
        } else {
            assert.match(envelope.userPrompt, /普通正文标记/);
            assert.match(envelope.userPrompt, /没有变化的模块输出 null/);
            assert.match(envelope.systemPrompt, /完整替换值/);
            assert.match(envelope.systemPrompt, /latestStage 必须等于 stages 最后一项/);
            assert.equal(mode.includes('世界书独立推演模式'), !includeExistingChat);
            assert.equal(mode.includes('聊天正文未作为'), !includeExistingChat);
            assert.doesNotMatch(mode, /历史批/);
        }
    }
}

// S2: historical batch systemPrompt must declare type→outcome mapping table and new-event daySummaries=[] anti-example
{
    const s2Envelope = buildTodayTrendGenerationEnvelope({ ...createInput,
        historyBatch: [{ role: 'assistant', content: 'S2 验证历史批' }],
        context: { source: { includeExistingChat: true }, mainChatText: '正文', latestChatText: '最新' } });
    const s2Prompt = s2Envelope.systemPrompt;
    const outcomeTableMatch = s2Prompt.match(/type→outcome 对照[\s\S]{0,500}?不是通用完结。/);
    assert.ok(outcomeTableMatch, '历史批 systemPrompt 必须包含 type→outcome 对照表');
    const outcomeTable = outcomeTableMatch[0];
    const commonOutcomes = ['resolved', 'failed', 'terminated', 'inconclusive'];
    const commonClause = outcomeTable.match(/normal、incident 仅可取 ([^；]*)；/);
    assert.ok(commonClause, 'normal、incident 必须明确共用仅可取集合');
    const rumorClause = outcomeTable.match(/rumor 仅可取 ([^；]*)；/);
    assert.ok(rumorClause, 'rumor 必须明确仅可取集合');
    assert.match(outcomeTable, /underground 可取上述四项或 absorbed（absorbed 须由 active incident 通过 relatedEventIds 关联承接）/,
        'underground 必须继承上述完整四项并仅增加 absorbed 及承接条件');
    for (const [type, actual, expected] of [
        ['normal', commonClause[1].split('|'), commonOutcomes],
        ['incident', commonClause[1].split('|'), commonOutcomes],
        ['rumor', rumorClause[1].split('|'), ['confirmed', 'debunked']],
        ['underground', [...commonClause[1].split('|'), 'absorbed'], [...commonOutcomes, 'absorbed']],
    ]) {
        assert.deepEqual(actual, expected, `${type} 允许集合必须完整且不得增加其他结果`);
        for (const outcome of expected) assert.ok(actual.includes(outcome), `${type} 必须允许 ${outcome}`);
    }
    assert.match(outcomeTable, /absorbed[\s\S]{0,150}active[\s\S]{0,30}incident[\s\S]{0,30}relatedEventIds/, '映射表必须说明 absorbed 须由 active incident 通过 relatedEventIds 承接');
    assert.match(outcomeTable, /不得为迁就结果而改 type/, '映射表必须禁止为迁就结果而改 type');
    assert.match(outcomeTable, /confirmed 仅表示传闻被证实，不是通用完结/, '映射表必须说明 confirmed 仅表示传闻被证实');
    // 与 model.js:127-132 一致性：rumor 不含 resolved 等；normal/incident 不含 confirmed/debunked/absorbed；underground 不含 confirmed/debunked
    // 直接排除全角分号；双反斜杠的 Unicode 拼写不是分号边界。
    const illegalRumorPatterns = [
        ['resolved', /rumor[^；]*resolved/], ['failed', /rumor[^；]*failed/],
        ['terminated', /rumor[^；]*terminated/], ['inconclusive', /rumor[^；]*inconclusive/],
        ['absorbed', /rumor[^；]*absorbed/],
    ];
    for (const [outcome, pattern] of illegalRumorPatterns) {
        assert.doesNotMatch(outcomeTable, pattern, `rumor 子句不得包含 ${outcome}`);
        const mutant = outcomeTable.replace(rumorClause[0], `rumor 仅可取 confirmed|debunked|${outcome}；`);
        assert.notEqual(mutant, outcomeTable, '变异必须实际改变测试字符串，不改生产 prompt');
        assert.match(mutant, pattern, `反向正则必须命中非法 rumor ${outcome} 变异`);
        assert.doesNotMatch(`rumor 仅可取 confirmed|debunked；其他类型 ${outcome}`, pattern,
            '反向正则不得跨越全角分号命中下一子句');
    }
    assert.doesNotMatch(outcomeTable, /normal[^；]*confirmed/, 'normal 子句不得包含 confirmed');
    assert.doesNotMatch(outcomeTable, /normal[^；]*debunked/, 'normal 子句不得包含 debunked');
    assert.doesNotMatch(outcomeTable, /normal[^；]*absorbed/, 'normal 子句不得包含 absorbed');
    assert.doesNotMatch(outcomeTable, /incident[^；]*confirmed/, 'incident 子句不得包含 confirmed');
    assert.doesNotMatch(outcomeTable, /incident[^；]*debunked/, 'incident 子句不得包含 debunked');
    assert.doesNotMatch(outcomeTable, /incident[^；]*absorbed/, 'incident 子句不得包含 absorbed');
    assert.doesNotMatch(outcomeTable, /underground[^；]*confirmed/, 'underground 子句不得包含 confirmed');
    assert.doesNotMatch(outcomeTable, /underground[^；]*debunked/, 'underground 子句不得包含 debunked');
    // 新建事件 daySummaries=[] 反例
    const newEventRule = s2Prompt.match(/新建事件在本批 create[^。]*。/)?.[0];
    assert.ok(newEventRule, '历史批必须明确本批 create 的新建事件规则');
    assert.match(newEventRule, /create 没有旧日开放阶段/, 'create 必须明确无旧日开放阶段');
    assert.match(newEventRule, /即使同批追加多个阶段/, '必须明确覆盖同批多阶段');
    assert.match(newEventRule, /daySummaries 也必须为 \[\]/, '新建事件封日摘要必须为空数组');
    assert.match(newEventRule, /禁止自行推断日期/, '新建事件规则必须禁止推断日期');
}


for (const invalid of [null, {}, '', ' ', 42, '字'.repeat(601)]) {
    const dto = structuredClone(createBatch);
    dto.dynamics.create[0].initialStage = invalid;
    assert.throws(() => materializeTodayTrendBatchDelta(dto, batchBase, 100), /create\[0\].initialStage/);
    dto.dynamics.create[0].initialStage = '开始';
    dto.dynamics.appendStages[0].stages = [invalid];
    assert.throws(() => materializeTodayTrendBatchDelta(dto, batchBase, 100), /appendStages\[0\].stages\[0\]/);
}
// Local new-write limit is independent of the legacy canonical read contract.
for (const stageText of ['字'.repeat(240), '😀'.repeat(120)]) {
    const dto = structuredClone(createBatch);
    dto.dynamics.create[0].initialStage = stageText;
    dto.dynamics.appendStages[0].stages = [stageText];
    const result = materializeTodayTrendBatchDelta(dto, batchBase, 100);
    assert.deepEqual(result.parsed.history.events[0].stages.map(stage => stage.text), [stageText, stageText]);
    assert.equal(normalizeTodayTrendHistoryProducer(phase5Producer('service', [phase5Stage(stageText)]))
        .events[0].stages[0].text, stageText);
}
for (const stageText of ['字'.repeat(241), '😀'.repeat(120) + '字', '字'.repeat(600)]) {
    const dto = structuredClone(createBatch);
    const beforeScope = JSON.stringify(batchBase);
    dto.dynamics.create[0].initialStage = stageText;
    assert.throws(() => materializeTodayTrendBatchDelta(dto, batchBase, 100), /initialStage.*240/);
    dto.dynamics.create[0].initialStage = '合法先行创建';
    dto.dynamics.appendStages[0].stages = ['合法先行阶段', stageText];
    assert.throws(() => materializeTodayTrendBatchDelta(dto, batchBase, 100), /appendStages.*240/);
    assert.equal(JSON.stringify(batchBase), beforeScope, '超长后续阶段不得部分修改输入');
    assert.throws(() => applyTodayTrendGenerationToV2(migratedValidV2, 'chat',
        phase5GeneratedScope(migratedValidV2, stageText), phase5Producer('service', [phase5Stage(stageText)])),
    error => error.code === 'TT_HISTORY_LIMIT_EXCEEDED' && /240/.test(error.message));
    assert.equal(JSON.stringify(migratedValidV2), beforeBatch, 'producer 超长不得半写 canonical');
    const controller = createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => ({}),
        buildGeneration: () => ({ systemPrompt: '', userPrompt: '' }), callAI: async () => JSON.stringify(dto), now: () => 100 });
    const beforeInput = JSON.stringify(createInput);
    await assert.rejects(() => controller.generate(createInput), /240/);
    assert.equal(JSON.stringify(createInput), beforeInput);
}
for (const length of [241, 600]) {
    const legacy = structuredClone(migratedValidV2);
    const event = legacy.globalEnvelope.payload.scopes.chat.payload.dynamics.active.find(item => item.id === 'service');
    event.stages.at(-1).text = '旧'.repeat(length);
    event.latestStage = event.stages.at(-1).text;
    const prefix = structuredClone(event.stages);
    const scope = phase5GeneratedScope(legacy, '新'.repeat(240));
    const updated = applyTodayTrendGenerationToV2(legacy, 'chat', scope,
        phase5Producer('service', [phase5Stage('新'.repeat(240))]), { assistantCount: 8, generatedAt: 100 });
    const stages = updated.globalEnvelope.payload.scopes.chat.payload.dynamics.active.find(item => item.id === 'service').stages;
    assert.deepEqual(stages.slice(0, -1), prefix, '旧241–600阶段读取追加必须保留原前缀');
    assert.equal(stages.at(-1).text.length, 240);
}
for (const field of ['daySummaries', 'periodSummaries']) {
    const summary = field === 'daySummaries' ? { summaryText: '摘'.repeat(240), keyStages: [] }
        : { summaryText: '摘'.repeat(240), startDate: '2025-04-15', endDate: '2025-04-16', childSummaryRefs: [] };
    const producer = phase5Producer('service', []);
    producer.events[0][field].push(summary);
    assert.equal(normalizeTodayTrendHistoryProducer(producer).events[0][field][0].summaryText.length, 240);
    summary.summaryText += '摘';
    assert.throws(() => normalizeTodayTrendHistoryProducer(producer), /summaryText/);
}

const objectProtocol = structuredClone(createBatch);
delete objectProtocol.dynamics.create[0].initialStage;
objectProtocol.dynamics.create[0].stages = [phase5Stage('旧协议')];
assert.throws(() => materializeTodayTrendBatchDelta(objectProtocol, batchBase, 100), /create\[0\].*initialStage/);
const duplicateCreate = structuredClone(createBatch);
duplicateCreate.dynamics.create[0].id = 'service';
assert.throws(() => materializeTodayTrendBatchDelta(duplicateCreate, batchBase, 100), /create\[0\].id/);
createBatch.dynamics.create[0].relatedEventIds = ['missing-reference'];
await assert.rejects(() => createController.generate(createInput));
createBatch.dynamics.create[0].relatedEventIds = relatedEventIds;
createBatch.dynamics.create[0].type = 'incident';
await assert.rejects(() => createController.generate({ ...createInput, allowHistoricalIncidentRecord: false }));
createBatch.dynamics.create[0].type = type;
await assert.rejects(() => createController.generate({ ...createInput,
    scope: { ...createInput.scope, dynamicsSettings: { ...createInput.scope.dynamicsSettings, autoComplete: false, archiveCompleted: false } } }));
const archivedNoopController = createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => ({}),
    buildGeneration: () => ({ systemPrompt: '', userPrompt: '' }), callAI: async () => JSON.stringify(batchEmpty()), now: () => 200 });
const archivedNoop = await archivedNoopController.generate({ ...createInput, scope: archivedScope });
const archivedNoopCanonical = applyTodayTrendGenerationToV2(batchArchived, 'chat', archivedNoop.scope, archivedNoop.history,
    { trustedStoryDate: '2025-04-15', assistantCount: 9, generatedAt: 200, archives: archivedNoop.archives });
assert.deepEqual(archivedNoopCanonical.globalEnvelope.payload.scopes.chat.payload.dynamics.archived,
    batchArchived.globalEnvelope.payload.scopes.chat.payload.dynamics.archived, '旧 canonical archived 隐藏阶段必须逐字段保留');
assert.deepEqual(archivedNoopCanonical.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent,
    batchArchived.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent, '空增量不得重建或丢弃隐藏 detail 池');



const phase5Dated = applyTodayTrendGenerationToV2(migratedValidV2, 'chat',
    phase5GeneratedScope(migratedValidV2, '完成摆盘'), phase5Producer('service', [phase5Stage('完成摆盘')]), {
        trustedStoryDate: '2025-04-15', assistantCount: 8,generatedAt: 100,
    });
const phase5DatedPayload = phase5Dated.globalEnvelope.payload.scopes.chat.payload;
const phase5DatedEvent = phase5DatedPayload.dynamics.active.find(item => item.id === 'service');
assert.equal(phase5DatedEvent.stages.at(-1).kind, 'live-stage', '可信日期必须生成 live-stage');
assert.equal(phase5DatedEvent.stages.at(-1).storyDate, '2025-04-15', 'live-stage 日期只能采用本地可信 storyDate');
assert.equal(phase5DatedEvent.stages.at(-1).sourceFloorStart, 8, '新增 stage 必须记录本轮助手楼层');

const phase5Undated = applyTodayTrendGenerationToV2(migratedValidV2, 'chat',
    phase5GeneratedScope(migratedValidV2, '无法定日的进展'), phase5Producer('service', [phase5Stage('无法定日的进展')]), {
        trustedStoryDate: null, assistantCount: 8, generatedAt: 100,
    });
const phase5UndatedStage = phase5Undated.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages.at(-1);
assert.equal(phase5UndatedStage.kind, 'undated-stage', '缺失可信日期必须生成 undated-stage');
assert.equal(phase5UndatedStage.storyDate, null, '缺失可信日期不得回退到设备日期');

const phase5SameDay = applyTodayTrendGenerationToV2(phase5Dated, 'chat',
    phase5GeneratedScope(phase5Dated, '当日继续备餐'), phase5Producer('service', [phase5Stage('当日继续备餐')]), {
        trustedStoryDate: '2025-04-15', assistantCount: 9, generatedAt: 110,
    });
assert.deepEqual(phase5SameDay.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages.slice(-2).map(stage => stage.kind),
    ['live-stage', 'live-stage'], '同日进展必须按 producer 原序追加 live-stage');

const phase5SameDayWithRedundantSummary = applyTodayTrendGenerationToV2(phase5SameDay, 'chat',
    phase5GeneratedScope(phase5SameDay, '同日冗余摘要后的继续备餐'), phase5Producer('service', [phase5Stage('同日冗余摘要后的继续备餐')], [
        { summaryText: '模型误报的当日摘要', keyStages: ['service'] },
    ]), { trustedStoryDate: '2025-04-15', assistantCount: 10, generatedAt: 115 });
const phase5SameDayWithRedundantSummaryEvent = phase5SameDayWithRedundantSummary.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0];
assert.deepEqual(phase5SameDayWithRedundantSummaryEvent.stages.slice(-3).map(stage => stage.kind),
    ['live-stage', 'live-stage', 'live-stage'], '同日冗余 day summary 不得阻止 live-stage 继续追加');
assert.equal(phase5SameDayWithRedundantSummaryEvent.stages.some(stage => stage.kind === 'day-summary'), false,
    '同日冗余 day summary 不得封闭或改写既有阶段历史');
assert.equal(phase5SameDayWithRedundantSummaryEvent.stages.at(-1).text, '同日冗余摘要后的继续备餐',
    '容错后仍必须追加本轮对应阶段正文');

const phase5NoOpenLiveWithRedundantSummary = applyTodayTrendGenerationToV2(migratedValidV2, 'chat',
    phase5GeneratedScope(migratedValidV2, '首次记录但模型误报摘要'), phase5Producer('service', [phase5Stage('首次记录但模型误报摘要')], [
        { summaryText: '不存在可封闭日期的摘要', keyStages: ['service'] },
    ]), { trustedStoryDate: '2025-04-15', assistantCount: 8, generatedAt: 105 });
const phase5NoOpenLiveWithRedundantSummaryPayload = phase5NoOpenLiveWithRedundantSummary.globalEnvelope.payload.scopes.chat.payload;
const phase5NoOpenLiveWithRedundantSummaryEvent = phase5NoOpenLiveWithRedundantSummaryPayload.dynamics.active[0];
assert.equal(phase5NoOpenLiveWithRedundantSummaryEvent.stages.at(-1).kind, 'live-stage',
    '没有开放 live-stage 时的冗余 day summary 不得阻止首个 live-stage 追加');
assert.equal(phase5NoOpenLiveWithRedundantSummaryEvent.stages.some(stage => stage.kind === 'day-summary'), false,
    '没有开放 live-stage 时不得伪造 day-summary');
assert.equal(phase5NoOpenLiveWithRedundantSummaryPayload.stageDetailsByEvent.service, undefined,
    '没有可封闭阶段时不得创建 detail 池副作用');

const phase5NextDay = applyTodayTrendGenerationToV2(phase5SameDay, 'chat',
    phase5GeneratedScope(phase5SameDay, '次日开始复盘'), phase5Producer('service', [phase5Stage('次日开始复盘')], [
        { summaryText: '首日完成摆盘与备餐', keyStages: ['service'] },
    ]), { trustedStoryDate: '2025-04-16', assistantCount: 10, generatedAt: 120 });
const phase5NextPayload = phase5NextDay.globalEnvelope.payload.scopes.chat.payload;
const phase5NextEvent = phase5NextPayload.dynamics.active[0];
assert.deepEqual(phase5NextEvent.stages.slice(-2).map(stage => stage.kind), ['day-summary', 'live-stage'],
    '日期前进必须先封闭旧日，再按原序追加新日 stage');
assert.equal(phase5NextEvent.stages.at(-2).detailCount, 2, '封日摘要必须保留被折叠 live-stage 的 detail 数量');
assert.equal(phase5NextPayload.stageDetailsByEvent.service.length, 2, '封日必须把原 live-stage 正文迁入 detail 容器');
// Reuse producer-generated closed-day details, then archive through the real batch controller.
const batchDetailArchive = await batchController.generate({ ...createInput, storyDate: '2025-04-16',
    scope: { ...buildReadOnlyShadow(phase5NextDay).scopes.chat, dynamicsSettings: batchCandidate.dynamicsSettings } });
const batchArchivedWithDetails = applyTodayTrendGenerationToV2(phase5NextDay, 'chat', batchDetailArchive.scope,
    batchDetailArchive.history, { trustedStoryDate: '2025-04-16', assistantCount: 11, generatedAt: 150,
        archives: batchDetailArchive.archives });
const batchDetailBaseline = structuredClone(batchArchivedWithDetails.globalEnvelope.payload.scopes.chat.payload);
assert.ok(batchDetailBaseline.dynamics.archived.some(event => event.id === 'service'),
    '非空 detail 保留夹具必须已归档 service');
assert.equal(batchDetailBaseline.stageDetailsByEvent.service?.length, 2,
    '空增量前置：必须保留 history producer 跨日封入的两条真实 canonical detail');
assert.deepEqual(batchDetailBaseline.stageDetailsByEvent.service, phase5NextPayload.stageDetailsByEvent.service,
    '归档前置：detail 必须来自既有 history producer，而非手工构造 schema');
const batchDetailNoop = await archivedNoopController.generate({ ...createInput, storyDate: '2025-04-16',
    scope: buildReadOnlyShadow(batchArchivedWithDetails).scopes.chat });
const batchDetailNoopCanonical = applyTodayTrendGenerationToV2(batchArchivedWithDetails, 'chat', batchDetailNoop.scope,
    batchDetailNoop.history, { trustedStoryDate: '2025-04-16', assistantCount: 12, generatedAt: 200,
        archives: batchDetailNoop.archives });
const batchDetailNoopPayload = batchDetailNoopCanonical.globalEnvelope.payload.scopes.chat.payload;
assert.equal(batchDetailNoopPayload.stageDetailsByEvent.service?.length, 2,
    '真实 controller 空增量落入 canonical 后 detail 必须仍非空');
assert.deepEqual(batchDetailNoopPayload.stageDetailsByEvent, batchDetailBaseline.stageDetailsByEvent,
    '真实 controller 空增量必须逐字段保留非空 canonical detail 池');
assert.deepEqual(batchDetailNoopPayload.dynamics.archived, batchDetailBaseline.dynamics.archived,
    '真实 controller 空增量必须逐字段保留携带 detail 的 archived 事件');
assert.equal(phase5NextPayload.removableEntityStateById['day:service:2025-04-15'].state, 'available',
    '新 day-summary 必须与 available lifecycle 同事务写入');

const phase5ParallelV1 = structuredClone(valid);
phase5ParallelV1.scopes.chat.dynamics.active.push({
    ...phase5ParallelV1.scopes.chat.dynamics.active[0], id: 'coordination', title: '后厨协调', stageLabel: '协调中',
    stages: ['分配岗位'], latestStage: '分配岗位', relatedEventIds: [],
});
const phase5ParallelBase = migrateTodayTrendStoreToV2(normalizeTodayTrendStore(phase5ParallelV1)).store;
const phase5ParallelScope = (store, serviceText, coordinationText) => {
    const scope = structuredClone(buildReadOnlyShadow(store).scopes.chat);
    for (const [id, text] of [['service', serviceText], ['coordination', coordinationText]]) {
        const event = scope.dynamics.active.find(item => item.id === id);
        event.stages.push(text);
        event.latestStage = text;
    }
    return scope;
};
const phase5ParallelDated = applyTodayTrendGenerationToV2(phase5ParallelBase, 'chat',
    phase5ParallelScope(phase5ParallelBase, '服务首日推进', '协调首日推进'), {
        events: ['service', 'coordination'].map(eventId => ({ eventId, stages: [phase5Stage(`${eventId === 'service' ? '服务' : '协调'}首日推进`)], daySummaries: [], periodSummaries: [] })),
    }, { trustedStoryDate: '2025-04-15', assistantCount: 8, generatedAt: 100 });
const phase5ParallelNextDay = applyTodayTrendGenerationToV2(phase5ParallelDated, 'chat',
    phase5ParallelScope(phase5ParallelDated, '服务次日推进', '协调次日推进'), {
        events: ['service', 'coordination'].map(eventId => ({ eventId, stages: [phase5Stage(`${eventId === 'service' ? '服务' : '协调'}次日推进`)],
            daySummaries: [{ summaryText: `${eventId} 首日摘要`, keyStages: [eventId] }], periodSummaries: [] })),
    }, { trustedStoryDate: '2025-04-16', assistantCount: 9, generatedAt: 110 });
assert.ok(phase5ParallelNextDay.globalEnvelope.payload.scopes.chat.payload.dynamics.active
    .filter(event => ['service', 'coordination'].includes(event.id)).every(event => event.stages.at(-2).kind === 'day-summary'),
    '多个事件在同一日期推进时必须各自封日，不能受跨事件数量配额拒绝');

assert.throws(() => applyTodayTrendGenerationToV2(phase5Dated, 'chat',
    phase5GeneratedScope(phase5Dated, '日期倒退进展'), phase5Producer('service', [phase5Stage('日期倒退进展')]), {
        trustedStoryDate: '2025-04-14', assistantCount: 9,
    }), error => error?.code === 'TT_DATE_REGRESSION', '可信日期倒退必须整单拒绝');
assert.throws(() => applyTodayTrendGenerationToV2(phase5Dated, 'chat',
    phase5GeneratedScope(phase5Dated, '缺少封日摘要'), phase5Producer('service', [phase5Stage('缺少封日摘要')]), {
        trustedStoryDate: '2025-04-16', assistantCount: 9,
    }), error => error?.code === 'TT_DATE_CONFLICT', '日期前进缺少 day summary 必须整单拒绝');
assert.throws(() => applyTodayTrendGenerationToV2(phase5Dated, 'chat',
    phase5GeneratedScope(phase5Dated, '未知引用摘要'), phase5Producer('service', [phase5Stage('未知引用摘要')], [
        { summaryText: '无效摘要', keyStages: ['missing-event'] },
    ]), { trustedStoryDate: '2025-04-16', assistantCount: 9 }),
error => error?.code === 'TT_HISTORY_UNKNOWN_KEY_STAGE', 'day summary 未知 keyStage 必须整单拒绝');
assert.throws(() => applyTodayTrendGenerationToV2(phase5Dated, 'chat',
    phase5GeneratedScope(phase5Dated, 'dynamics 新阶段'), phase5Producer('service', [phase5Stage('history 错误阶段')]), {
        trustedStoryDate: '2025-04-15', assistantCount: 9,
    }), error => error?.code === 'TT_HISTORY_STAGE_MISMATCH',
'history 与 dynamics 新增阶段正文不一致时必须整单拒绝');
assert.throws(() => applyTodayTrendGenerationToV2(phase5SameDay, 'chat',
    phase5GeneratedScope(phase5SameDay, '复合错误的 dynamics 阶段'), phase5Producer('service', [phase5Stage('复合错误的 history 阶段')], [
        { summaryText: '同日冗余摘要', keyStages: ['service'] },
    ]), { trustedStoryDate: '2025-04-15', assistantCount: 10,
    }), error => error?.code === 'TT_HISTORY_STAGE_MISMATCH',
    '历史追加不一致必须优先于同日冗余 day summary 的容错判定暴露');
assert.throws(() => applyTodayTrendGenerationToV2(phase5Dated, 'chat',
    phase5GeneratedScope(phase5Dated, '日期倒退的 dynamics 阶段'), phase5Producer('service', [phase5Stage('日期倒退的 history 阶段')]), {
        trustedStoryDate: '2025-04-14', assistantCount: 10,
    }), error => error?.code === 'TT_HISTORY_STAGE_MISMATCH',
    '历史追加不一致必须优先于日期倒退错误暴露');
assert.throws(() => applyTodayTrendGenerationToV2(phase5Dated, 'chat',
    phase5GeneratedScope(phase5Dated, '跨日缺摘要的 dynamics 阶段'), phase5Producer('service', [phase5Stage('跨日缺摘要的 history 阶段')]), {
        trustedStoryDate: '2025-04-16', assistantCount: 10,
    }), error => error?.code === 'TT_HISTORY_STAGE_MISMATCH',
    '历史追加不一致必须优先于跨日缺少 day summary 错误暴露');
assert.throws(() => applyTodayTrendGenerationToV2(phase5SameDay, 'chat',
    phase5GeneratedScope(phase5SameDay, '冗余摘要不能支撑时期折叠'), phase5Producer('service', [phase5Stage('冗余摘要不能支撑时期折叠')], [
        { summaryText: '无效当日摘要', keyStages: ['service'] },
    ], [{ summaryText: '无效摘要不应提供配额', startDate: '2025-04-15', endDate: '2025-04-15', childSummaryRefs: [] }]), {
        trustedStoryDate: '2025-04-15', assistantCount: 10,
    }), error => error?.code === 'TT_HISTORY_LIMIT_EXCEEDED',
    '冗余 day summary 不得为 period summary 提供配额');
assert.throws(() => normalizeTodayTrendHistoryProducer(phase5Producer('service', [], [{
    summaryText: '过长摘要'.repeat(61), keyStages: ['service'],
}])), error => error?.code === 'TT_HISTORY_SCHEMA_INVALID', 'summaryText 超过 240 字必须整单拒绝');
assert.throws(() => normalizeTodayTrendHistoryProducer(phase5Producer('service', [], [], [{
    summaryText: '跨度越界', startDate: '2025-04-01', endDate: '2025-04-08', childSummaryRefs: [],
}])), error => error?.code === 'TT_HISTORY_LIMIT_EXCEEDED', 'period summary 超过七日跨度必须整单拒绝');
const phase5PeriodCandidates = normalizeTodayTrendHistoryProducer({ events: [
    { eventId: 'service', stages: [], daySummaries: [{ summaryText: '服务摘要', keyStages: ['service'] }], periodSummaries: [{
        summaryText: '后续由确定性规划器处理的时期候选', startDate: '2025-04-15', endDate: '2025-04-15',
        childSummaryRefs: ['day:service:2025-04-15'],
    }] },
    { eventId: 'rumor', stages: [], daySummaries: [{ summaryText: '传闻摘要', keyStages: ['rumor'] }], periodSummaries: [] },
    { eventId: 'incident', stages: [], daySummaries: [{ summaryText: '事件摘要', keyStages: ['incident'] }], periodSummaries: [] },
] });
assert.equal(phase5PeriodCandidates.events[0].periodSummaries[0].summaryText, '后续由确定性规划器处理的时期候选',
    '阶段 5 必须保留同一 reducer 调用内通过限额校验的 period summary 候选');
for (const [field, value] of [
    ['startDate', '2025-02-30'], ['endDate', '2025-02-30'],
]) {
    const candidate = structuredClone(phase5PeriodCandidates);
    candidate.events[0].periodSummaries[0][field] = value;
    assert.throws(() => normalizeTodayTrendHistoryProducer(candidate),
        error => error?.code === 'TT_HISTORY_SCHEMA_INVALID', `period producer 必须拒绝 ${field} 不存在的日期`);
}
const phase5ReversedPeriod = structuredClone(phase5PeriodCandidates);
phase5ReversedPeriod.events[0].periodSummaries[0].startDate = '2025-04-16';
assert.throws(() => normalizeTodayTrendHistoryProducer(phase5ReversedPeriod),
    error => error?.code === 'TT_HISTORY_SCHEMA_INVALID', 'period producer 必须拒绝倒序日期区间');
const phase5LeapPeriod = structuredClone(phase5PeriodCandidates);
Object.assign(phase5LeapPeriod.events[0].periodSummaries[0], {
    startDate: '2024-02-29', endDate: '2024-03-01',
});
assert.deepEqual(
    normalizeTodayTrendHistoryProducer(phase5LeapPeriod).events[0].periodSummaries[0],
    phase5LeapPeriod.events[0].periodSummaries[0],
    'period producer 必须接受闰年 02-29 与跨月合法区间',
);
assert.throws(() => normalizeTodayTrendHistoryProducer(phase5Producer('service', [], [{
    summaryText: '摘要一', keyStages: ['service'],
}, {
    summaryText: '摘要二', keyStages: ['service'],
}])), error => error?.code === 'TT_HISTORY_LIMIT_EXCEEDED',
'单个 event 每轮产生两条 day summary 必须继续整单拒绝');

const phase5RolledBack = rollbackTodayTrendV2Scope(phase5NextDay, 'chat', 9);
const phase5RolledBackPayload = phase5RolledBack.globalEnvelope.payload.scopes.chat.payload;
assert.equal(phase5RolledBackPayload.dynamics.active[0].stages.at(-1).text, '当日继续备餐',
    'canonical rollback 必须恢复目标楼层的 Projection');
assert.equal(phase5RolledBackPayload.generationSnapshots.at(-1).assistantCount, 9,
    'canonical rollback 必须裁剪已消失楼层后的快照');

let phase5SchedulerStore = structuredClone(migratedValidV2);
let phase5CalendarStore = { version: 1, scopes: { chat: { baseDate: '2025-04-15' } } };
let phase5GenerateCalls = 0;
let phase5CommitOptions = null;
const phase5SchedulerCommitter = {
    supportsCanonical: true,
    invalidateCommits: () => {},
    commitStore: async (mutate, task, options) => {
        phase5CommitOptions = options;
        phase5SchedulerStore = await mutate(structuredClone(phase5SchedulerStore));
        return buildReadOnlyShadow(phase5SchedulerStore);
    },
};
const phase5Scheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope, storyDate, summaryOnly }) => {
        phase5GenerateCalls += 1;
        assert.equal(storyDate, '2025-04-15', 'scheduler 必须把 calendar baseDate 作为可信 storyDate 快照');
        assert.equal(summaryOnly, false, '常规生成不得误标 summary-only');
        const generatedScope = structuredClone(scope);
        generatedScope.dynamics.active[0].stages.push('调度器新增进展');
        generatedScope.dynamics.active[0].latestStage = '调度器新增进展';
        return { scope: generatedScope, history: phase5Producer('service', [phase5Stage('调度器新增进展')]) };
    } },
    committer: phase5SchedulerCommitter, getStore: async () => buildReadOnlyShadow(phase5SchedulerStore),
    getStorageId: () => 'chat', getCalendarStore: () => phase5CalendarStore, getFloor: () => 8,
});
await phase5Scheduler.manual();
assert.equal(phase5GenerateCalls, 1, 'history producer 必须与结构模块共用一次 AI 调用');
assert.deepEqual(phase5CommitOptions, { canonical: true, scopeId: 'chat' },
    '支持 canonical 的 scheduler 必须在统一 commitStore 写链显式声明 canonical scope');
assert.equal(phase5SchedulerStore.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages.at(-1).kind,
    'live-stage', 'scheduler canonical 事务必须持久化 history Projection');

const phase5HistoryErrorController = createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({
        world: null, reputation: null, factions: null, dynamics: null,
        history: { events: [], debug: true },
    }),
});
await assert.rejects(() => phase5HistoryErrorController.generate({
    scope: valid.scopes.chat, preset: valid.presets.preset, storyDate: '2025-04-15', summaryOnly: true,
}), error => error?.code === 'TT_HISTORY_SCHEMA_INVALID'
    && !error.message.startsWith('今日风向生成失败：'),
'generation 控制器必须原样透传 history reducer 结构化错误码');

const phase5SummaryOnlyController = createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({
        world: null, reputation: null, factions: null, dynamics: null, history: { events: [] },
    }),
});
const phase5SummaryOnlyResult = await phase5SummaryOnlyController.generate({
    scope: valid.scopes.chat, preset: valid.presets.preset, storyDate: '2025-04-15', summaryOnly: true,
});
assert.deepEqual(phase5SummaryOnlyResult.history, { events: [] },
    'summary-only 必须接受不改写结构模块的合法 history 闭集');
assert.deepEqual(phase5SummaryOnlyResult.scope, valid.scopes.chat,
    'summary-only 合法响应不得改变当前结构 Projection');
const phase5SummaryOnlyMutationController = createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => JSON.stringify({
        world: { items: [{ id: 'world', name: '节目风向', summary: '禁止改写' }] },
        reputation: null, factions: null, dynamics: null, history: { events: [] },
    }),
});
await assert.rejects(() => phase5SummaryOnlyMutationController.generate({
    scope: valid.scopes.chat, preset: valid.presets.preset, storyDate: '2025-04-15', summaryOnly: true,
}), /summary-only 不得返回结构模块变更/,
'summary-only 返回任一结构模块变更时必须 fail closed');

let phase5DriftStore = structuredClone(migratedValidV2);
let phase5DriftCalendar = { version: 1, scopes: { chat: { baseDate: '2025-04-15' } } };
const phase5DriftBefore = JSON.stringify(phase5DriftStore);
const phase5DriftScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope, storyDate }) => {
        assert.equal(storyDate, '2025-04-15', '漂移检测必须以生成开始时的 calendar baseDate 为快照');
        phase5DriftCalendar = { version: 1, scopes: { chat: { baseDate: '2025-04-16' } } };
        const generatedScope = structuredClone(scope);
        generatedScope.dynamics.active[0].stages.push('不应提交的漂移进展');
        generatedScope.dynamics.active[0].latestStage = '不应提交的漂移进展';
        return { scope: generatedScope, history: phase5Producer('service', [phase5Stage('不应提交的漂移进展')]) };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        commitStore: async (mutate, task, options) => {
            phase5DriftStore = await mutate(structuredClone(phase5DriftStore));
            return buildReadOnlyShadow(phase5DriftStore);
        },
    },
    getStore: async () => buildReadOnlyShadow(phase5DriftStore), getStorageId: () => 'chat',
    getCalendarStore: () => phase5DriftCalendar, getFloor: () => 8,
});
await assert.rejects(() => phase5DriftScheduler.manual(),
    error => error?.name === 'AbortError' && error?.code === 'TT_DATE_DRIFT',
    'calendar baseDate 在生成期间漂移必须阻断 canonical 提交');
assert.equal(phase5DriftScheduler.state().phase, 'canceled', '日历漂移必须以 canceled 终止，不得伪报生成失败');
assert.equal(JSON.stringify(phase5DriftStore), phase5DriftBefore, '日历漂移不得留下部分 canonical 写入');

let phase5V1Store = structuredClone(valid);
let phase5V1History = { events: [] };
let phase5V1CommitOptions = null;
const phase5V1Scheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope, storyDate }) => {
        assert.equal(storyDate, null, '缺日历资料的 v1 兼容路径不得回退设备日期');
        const generatedScope = structuredClone(scope);
        generatedScope.dynamics.active[0].stages.push('v1 兼容进展');
        generatedScope.dynamics.active[0].latestStage = 'v1 兼容进展';
        return { scope: generatedScope, history: phase5V1History };
    } },
    committer: {
        supportsCanonical: false, invalidateCommits: () => {},
        commitStore: async (mutate, task, options) => {
            phase5V1CommitOptions = options;
            phase5V1Store = await mutate(structuredClone(phase5V1Store));
            return phase5V1Store;
        },
    },
    getStore: async () => structuredClone(phase5V1Store), getStorageId: () => 'chat', getFloor: () => 8,
});
await phase5V1Scheduler.manual();
assert.deepEqual(phase5V1CommitOptions, { canonical: false, scopeId: 'chat' },
    '不支持 canonical 的提交器必须显式走原 v1 事务分支');
assert.equal(phase5V1Store.scopes.chat.generationSnapshots.at(-1).assistantCount, 8,
    'v1 兼容路径必须继续追加 generation snapshot');
phase5V1History = phase5Producer('service', [phase5Stage('禁止降级的 history')]);
const phase5V1BeforeRejectedHistory = JSON.stringify(phase5V1Store);
await assert.rejects(() => phase5V1Scheduler.manual({ floor: 9 }),
    error => error?.code === 'TT_V2_REQUIRED',
    'v1 提交器收到非空 history 时必须 fail closed，禁止丢弃 canonical 数据');
assert.equal(JSON.stringify(phase5V1Store), phase5V1BeforeRejectedHistory,
    'TT_V2_REQUIRED 拒绝路径不得修改 v1 store');

const phase5ChainHarness = createAuthorityHarness();
const phase5ChainCasWrites = [];
const phase5ChainAuthority = createTodayTrendV2Authority({
    readEntry: phase5ChainHarness.readEntry,
    compareAndSwap: async request => {
        phase5ChainCasWrites.push(request.writes.map(entry => entry.key));
        return phase5ChainHarness.compareAndSwap(request);
    },
    tabId: 'phase-5-chain-owner', BroadcastChannelImpl: undefined,
});
await phase5ChainAuthority.acquire({ readV2: true, writeV2: true, initialStore: valid });
let phase5ChainNow = 9000;
const phase5ChainPhases = [];
const phase5ChainJournal = createTodayTrendJournal({
    listKeys: async () => [...phase5ChainHarness.records.keys()], readEntry: phase5ChainHarness.readEntry,
    writeEntry: async (key, value) => {
        phase5ChainHarness.records.set(key, structuredClone(value));
        phase5ChainPhases.push(value.phase);
        return true;
    },
    deleteEntry: async key => phase5ChainHarness.records.delete(key), now: () => ++phase5ChainNow,
    transactionId: () => `phase-5-chain-${phase5ChainNow}`,
});
const phase5ChainStorage = createTodayTrendStorage({
    v2Authority: phase5ChainAuthority, journal: phase5ChainJournal, storage: memoryStorage(),
});
const phase5ChainRuntime = {};
const phase5ChainRefreshes = [];
const phase5ChainCommitter = createTodayTrendCommitter({
    runtime: phase5ChainRuntime, load: phase5ChainStorage.load, loadCanonical: phase5ChainStorage.loadCanonical,
    save: phase5ChainStorage.save, storageStatus: phase5ChainStorage.status, journal: phase5ChainJournal,
    refreshInjection: async store => { phase5ChainRefreshes.push(structuredClone(store)); return { failedWrites: 0, failedKeys: [] }; },
});
let phase5ChainAiCalls = 0;
const phase5ChainController = createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => {
        phase5ChainAiCalls += 1;
        const dynamics = structuredClone(valid.scopes.chat.dynamics);
        const service = dynamics.active.find(event => event.id === 'service');
        service.stages.push('完整生产链新增进展');
        service.latestStage = '完整生产链新增进展';
        return JSON.stringify({
            world: null, reputation: null, factions: null, dynamics,
            history: phase5Producer('service', [{ text: '完整生产链新增进展', time: '23:59', timeLabel: null }]),
        });
    },
});
const phase5ChainScheduler = createTodayTrendScheduler({
    controller: phase5ChainController, committer: phase5ChainCommitter, getStore: phase5ChainStorage.load,
    getStorageId: () => 'chat', getCalendarStore: () => ({ version: 1, scopes: { chat: { baseDate: '2025-04-15' } } }),
    getFloor: () => 8, now: () => 9100,
});
await phase5ChainScheduler.manual();
assert.equal(phase5ChainAiCalls, 1, '真实 generation controller 到 canonical 提交链每轮只能调用一次 AI transport');
const phase5ChainPersisted = (await phase5ChainAuthority.load()).v2Store.globalEnvelope.payload.scopes.chat.payload;
assert.equal(phase5ChainPersisted.dynamics.active.find(event => event.id === 'service').stages.at(-1).time, '23:59',
    '同一 AI JSON的 dynamics 与 history 必须经真实 scheduler/committer 持久化为合法 live-stage');
assert.ok(phase5ChainCasWrites.some(keys => keys.length === 3 && keys.includes(TODAY_TREND_V2_STORAGE_KEY)
    && keys.includes(TODAY_TREND_V2_AUTHORITY_KEY) && keys.some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX))),
    '真实生产链必须把 candidate store、authority 与 store-written journal 放入同一 CAS');
assert.ok(phase5ChainPhases.includes('injection-written') && phase5ChainPhases.includes('accepted'),
    '真实生产链必须完成 journal 的 injection-written 与 accepted 终态');
assert.equal(phase5ChainRefreshes.length, 1, '真实生产链成功提交只能刷新一次 candidate 注入');
assert.equal([...phase5ChainHarness.records.keys()].some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX)), false,
    '真实生产链 accepted 后不得残留开放 journal');
assert.equal(await phase5ChainAuthority.release({ readV2: true, serveV2: false }), true, '阶段 5 生产链 harness 必须释放 authority owner');

const batchReadyWithSiblingV2 = structuredClone(batchReadyValidV2);
batchReadyWithSiblingV2.globalEnvelope.payload.scopes.sibling = copyTodayTrendV2ScopeForBranch(
    batchReadyValidV2.globalEnvelope.payload.scopes.chat, 'sibling', 0,
    batchReadyValidV2.globalEnvelope.payload.presets,
);
const phase5MultiHarness = createAuthorityHarness();
const phase5MultiAuthority = createTodayTrendV2Authority({
    readEntry: phase5MultiHarness.readEntry,
    compareAndSwap: phase5MultiHarness.compareAndSwap,
    tabId: 'phase-5-multi-owner', BroadcastChannelImpl: undefined,
});
await phase5MultiAuthority.acquire({ readV2: true, writeV2: true, initialStore: batchReadyWithSiblingV2 });
let phase5MultiNow = 12000;
const phase5MultiPhases = [];
const phase5MultiJournal = createTodayTrendJournal({
    listKeys: async () => [...phase5MultiHarness.records.keys()], readEntry: phase5MultiHarness.readEntry,
    writeEntry: async (key, value) => {
        phase5MultiHarness.records.set(key, structuredClone(value));
        phase5MultiPhases.push(value.phase);
        return true;
    },
    deleteEntry: async key => phase5MultiHarness.records.delete(key), now: () => ++phase5MultiNow,
    transactionId: () => `phase-5-multi-${phase5MultiNow}`,
});
const phase5MultiCasWrites = [];
const phase5MultiOriginalCas = phase5MultiHarness.compareAndSwap;
assert.equal(await phase5MultiAuthority.release({ readV2: true, serveV2: false }), true,
    '阶段 5 多批 trace harness 初始化 owner 必须显式 release');
const phase5MultiAuthorityWithTrace = createTodayTrendV2Authority({
    readEntry: phase5MultiHarness.readEntry,
    compareAndSwap: async request => {
        phase5MultiCasWrites.push(request.writes.map(entry => entry.key));
        return phase5MultiOriginalCas(request);
    },
    tabId: 'phase-5-multi-owner', BroadcastChannelImpl: undefined,
});
await phase5MultiAuthorityWithTrace.acquire({ readV2: true, writeV2: true, initialStore: batchReadyWithSiblingV2 });
const phase5MultiStorage = createTodayTrendStorage({
    v2Authority: phase5MultiAuthorityWithTrace, journal: phase5MultiJournal, storage: memoryStorage(),
});
const phase5MultiRuntime = {};
const phase5MultiRefreshes = [];
let phase5MultiBatch = 0;
const phase5MultiCommitter = createTodayTrendCommitter({
    runtime: phase5MultiRuntime, load: phase5MultiStorage.load, loadCanonical: phase5MultiStorage.loadCanonical,
    save: phase5MultiStorage.save, storageStatus: phase5MultiStorage.status, journal: phase5MultiJournal,
    refreshInjection: async store => { phase5MultiRefreshes.push(structuredClone(store)); return { failedWrites: 0, failedKeys: [] }; },
});
const phase5MultiChat = Array.from({ length: 4 }, (_, index) => ({ role: 'assistant', content: `真实多批正文${index + 1}` }));
const phase5MultiController = {
    generate: async ({ scope, assistantCount }) => {
        phase5MultiBatch += 1;
        const generatedScope = structuredClone(scope);
        generatedScope.world = { items: [{ id: `phase5-world-${assistantCount}`, name: '当前批世界态势',
            summary: `真实多批第${phase5MultiBatch}批-${assistantCount}` }] };
        return { scope: generatedScope, history: { events: [] } };
    },
};
const phase5MultiScheduler = createTodayTrendScheduler({
    controller: phase5MultiController, committer: phase5MultiCommitter, getStore: phase5MultiStorage.load,
    getStorageId: () => 'chat', getChat: () => phase5MultiChat,
    getCalendarStore: () => ({ version: 1, scopes: { chat: { baseDate: '2025-04-15' } } }),
    getFloor: () => 4, commitFeedbackMs: 0,
});
await phase5MultiScheduler.manual({ batchEnabled: true, recentAssistantCount: 4, mergeAssistantCount: 2 });
const phase5MultiPersisted = (await phase5MultiAuthorityWithTrace.load()).v2Store.globalEnvelope.payload.scopes.chat.payload;
assert.equal(phase5MultiBatch, 2, '真实 committer 多批 harness 必须逐批调用 AI');
assert.equal(phase5MultiPersisted.world.items[0].summary, '真实多批第2批-4',
    '真实多批提交的第二批必须读取并保留第一批 canonical 内容');
assert.equal(phase5MultiPersisted.historyRetentionState.highWaterAssistantCount, 4,
    '批量重建后 highWaterAssistantCount 必须只向最终成功批次单调推进');
assert.equal(phase5MultiPersisted.generationSnapshots.find(item => item.assistantCount === 2)?.rerollFromAssistantCount, null,
    '首批内容快照不得伪造已删除旧内容的 reroll 基线');
assert.equal(phase5MultiRefreshes.length, 3, '批量启动清空及每批成功都必须各刷新一次 candidate 注入');
assert.equal(phase5MultiCasWrites.filter(keys => keys.includes(TODAY_TREND_V2_STORAGE_KEY)
    && keys.includes(TODAY_TREND_V2_AUTHORITY_KEY)
    && keys.some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX))).length, 3,
    '批量启动清空和每批提交都必须将 store、authority 与 journal 放入同一个 CAS');
assert.ok(phase5MultiPhases.filter(phase => phase === 'accepted').length >= 3,
    '真实多批必须完成清空事务与每批事务的 journal accepted 终态');
assert.equal([...phase5MultiHarness.records.keys()].some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX)), false,
    '真实多批 accepted 后不得残留开放 journal');
assert.deepEqual((await phase5MultiAuthorityWithTrace.load()).v2Store.globalEnvelope.payload.scopes.sibling,
    batchReadyWithSiblingV2.globalEnvelope.payload.scopes.sibling,
    '批量生成只能提交当前 scope，不得因 v1 facade 合并改写 sibling canonical scope');

// Real controller + storage/authority: failed later batch retains the accepted first batch.
let deltaBatchCalls = 0;
let deltaBatchFail = true;
const deltaBatchController = createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => ({}),
    buildGeneration: () => ({ systemPrompt: '', userPrompt: '' }), now: () => 200,
    callAI: async () => {
        deltaBatchCalls += 1;
        if (deltaBatchFail && deltaBatchCalls === 2) throw new Error('delta-second-batch-failed');
        const dto = batchEmpty();
        dto.world.upserts.push({ id: `delta-${deltaBatchCalls}`, name: '增量世界', summary: `成功批${deltaBatchCalls}` });
        return JSON.stringify(dto);
    } });
const deltaBatchScheduler = createTodayTrendScheduler({ controller: deltaBatchController, committer: phase5MultiCommitter,
    getStore: phase5MultiStorage.load, getStorageId: () => 'chat', getChat: () => phase5MultiChat,
    getFloor: () => 4, commitFeedbackMs: 0 });
await assert.rejects(() => deltaBatchScheduler.manual({ batchEnabled: true, recentAssistantCount: 4, mergeAssistantCount: 2 }), /delta-second-batch-failed/);
const deltaAfterFailure = await phase5MultiStorage.loadCanonical();
assert.equal(deltaAfterFailure.globalEnvelope.payload.scopes.chat.payload.world.items.some(item => item.id === 'delta-1'), true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(deltaBatchCalls, 2, '失败不得自动恢复或继续调用 AI');
deltaBatchFail = false;
await deltaBatchScheduler.manual({ batchEnabled: true, recentAssistantCount: 2, mergeAssistantCount: 2 });
assert.equal(deltaBatchCalls, 3, '用户修改窗口后只能执行新手动窗口');
assert.equal((await phase5MultiStorage.loadCanonical()).globalEnvelope.payload.scopes.chat.payload.world.items.some(item => item.id === 'delta-3'), true);
const deltaBeforeCasConflict = await phase5MultiStorage.loadCanonical();
await assert.rejects(() => phase5MultiCommitter.commitStore(store => store, {}, { canonical: true, scopeId: 'chat',
    expectedStoreRevision: deltaBeforeCasConflict.globalEnvelope.revision - 1,
    expectedScopeRevision: deltaBeforeCasConflict.globalEnvelope.payload.scopes.chat.revision }));
assert.deepEqual(await phase5MultiStorage.loadCanonical(), deltaBeforeCasConflict, '过期 CAS 不得覆盖手动继续后的 canonical');

let phase5MultiDrifted = false;
const phase5CanonicalDriftCommitter = createTodayTrendCommitter({
    runtime: {}, load: phase5MultiStorage.load, loadCanonical: phase5MultiStorage.loadCanonical,
    save: phase5MultiStorage.save, storageStatus: phase5MultiStorage.status, journal: phase5MultiJournal,
    refreshInjection: async store => {
        if (!phase5MultiDrifted) {
            phase5MultiDrifted = true;
            const current = await phase5MultiAuthorityWithTrace.load();
            const drifted = structuredClone(current.v2Store);
            const scope = drifted.globalEnvelope.payload.scopes.chat.payload;
            scope.world.items = [{ id: 'phase5-external-world', name: '外部世界态势', summary: '批间外部 canonical 修改' }];
            await phase5MultiAuthorityWithTrace.save(drifted, { scopeId: 'chat' });
        }
        return { failedWrites: 0, failedKeys: [] };
    },
});
let phase5CanonicalDriftCalls = 0;
const phase5CanonicalDriftScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope, assistantCount }) => {
        phase5CanonicalDriftCalls += 1;
        const generatedScope = structuredClone(scope);
        generatedScope.world = { items: [{ id: `phase5-drift-world-${assistantCount}`, name: '当前批世界态势',
            summary: `漂移前生成${assistantCount}` }] };
        return { scope: generatedScope, history: { events: [] } };
    } },
    committer: phase5CanonicalDriftCommitter, getStore: phase5MultiStorage.load,
    getStorageId: () => 'chat', getChat: () => phase5MultiChat,
    getCalendarStore: () => ({ version: 1, scopes: { chat: { baseDate: '2025-04-15' } } }), getFloor: () => 4,
});
await phase5CanonicalDriftScheduler.manual({ batchEnabled: true, recentAssistantCount: 4, mergeAssistantCount: 2 });
assert.equal(phase5CanonicalDriftCalls, 2, '批间 canonical 内容变化若发生在已完成批之后，不得误判为当前批迟到结果');
assert.equal((await phase5MultiAuthorityWithTrace.load()).v2Store.globalEnvelope.payload.scopes.chat.payload.world.items[0].summary,
    '漂移前生成4', '后续批必须基于批间最新 canonical 内容提交，而非覆盖外部变化');

let phase5LateRelease;
let phase5LateRefreshEntered = false;
let phase5LateRefreshCalls = 0;
const phase5LateBefore = structuredClone((await phase5MultiAuthorityWithTrace.load()).v2Store);
const phase5LateRuntime = {};
const phase5LateCommitter = createTodayTrendCommitter({
    runtime: phase5LateRuntime, load: phase5MultiStorage.load, loadCanonical: phase5MultiStorage.loadCanonical,
    save: phase5MultiStorage.save, storageStatus: phase5MultiStorage.status, journal: phase5MultiJournal,
    refreshInjection: async () => {
        phase5LateRefreshCalls += 1;
        if (phase5LateRefreshCalls === 1) {
            phase5LateRefreshEntered = true;
            await new Promise(resolve => { phase5LateRelease = resolve; });
        }
        return { failedWrites: 0, failedKeys: [] };
    },
});
const phase5LateScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => ({ scope: { ...scope, world: { items: [{ ...scope.world.items[0], summary: '取消后的迟到结果' }] } }, history: { events: [] } }) },
    committer: phase5LateCommitter, getStore: phase5MultiStorage.load, getStorageId: () => 'chat',
    getChat: () => phase5MultiChat, getCalendarStore: () => ({ version: 1, scopes: { chat: { baseDate: '2025-04-15' } } }),
    getFloor: () => 4,
});
const phase5LateRun = phase5LateScheduler.manual();
for (let index = 0; index < 100 && !phase5LateRefreshEntered; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
}
assert.equal(phase5LateRefreshEntered, true, '真实 committer 取消矩阵必须等待 candidate 已写入后的注入阶段');
phase5LateScheduler.cancel('phase-5-late-cancel');
phase5LateRelease();
await assert.rejects(() => phase5LateRun, error => error?.name === 'AbortError', '取消后的真实 candidate 注入迟到必须回滚并报告 AbortError');
const phase5LateAfter = (await phase5MultiAuthorityWithTrace.load()).v2Store;
assert.deepEqual(buildReadOnlyShadow(phase5LateAfter), buildReadOnlyShadow(phase5LateBefore),
    '取消后的迟到 candidate 必须经真实 compensation CAS 恢复 previous canonical 内容');
assert.ok(phase5LateAfter.globalEnvelope.revision > phase5LateBefore.globalEnvelope.revision,
    '取消补偿必须通过新的 canonical revision 写入，而不是回写旧 revision');
assert.equal(phase5LateCommitter.isBlocked(), false, '可完成 previous 注入补偿的取消不得留下 blocked journal');
assert.equal([...phase5MultiHarness.records.keys()].some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX)), false,
    '取消补偿完成后不得残留 journal 或 pending injection 状态');
assert.equal(phase5LateRuntime.pendingInjectionStore, undefined,
    '取消补偿完成后不得残留 pending injection store');
await phase5MultiAuthorityWithTrace.release({ readV2: true, serveV2: false });


// Historical permission is only a creation gate, not evidence verification or a type/field bypass.
for (const enabled of [false, true]) {
    const scope = structuredClone(createInput.scope);
    scope.dynamicsSettings.incident.enabled = enabled;
    scope.dynamicsSettings.incident.probability = enabled ? 0 : 100;
    scope.dynamicsSettings.rumor.enabled = false;
    scope.dynamicsSettings.underground.enabled = false;
    scope.dynamics.active.find(event => event.id === 'service').type = 'incident';
    let dto = batchEmpty();
    dto.dynamics.appendStages.push({ eventId: 'service', stages: ['已有事故获得明确新进展'] });
    const controller = createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => ({}),
        callAI: async () => JSON.stringify(dto), now: () => 100 });
    const input = { ...createInput, scope, allowIncident: true, allowHistoricalIncidentRecord: true };
    const appended = await controller.generate(input);
    assert.equal(appended.scope.dynamics.active.find(event => event.id === 'service').latestStage, '已有事故获得明确新进展');
    for (const eventType of ['rumor', 'underground']) {
        dto.dynamics.create = [{ ...createBatch.dynamics.create[0], id: 's1-other', type: eventType, relatedEventIds: [] }];
        await assert.rejects(() => controller.generate(input), /本轮未允许生成/);
    }
    dto = batchEmpty();
    assert.deepEqual((await controller.generate(input)).scope.dynamics, scope.dynamics, '空批协议保留，无事实 mock 不生成事件');
    dto.dynamics.create = [{ ...createBatch.dynamics.create[0], id: 's1-invalid', type: 'incident', initialStage: '长'.repeat(241) }];
    await assert.rejects(() => controller.generate(input), /240/);
    dto.dynamics.create[0].initialStage = '本批事故事实';
    if (!enabled) await assert.rejects(() => controller.generate(input), /未允许生成突发事件/);
    else {
        await assert.rejects(() => controller.generate({ ...input, allowHistoricalIncidentRecord: false }), /未允许生成突发事件/);
        await assert.rejects(() => controller.generate({ ...input, allowHistoricalIncidentRecord: undefined }), /未允许生成突发事件/);
    }
}

// S1: real scheduler -> controller -> envelope -> validators, isolated canonical memory only.
for (const historical of [false, true]) for (const enabled of [false, true]) {
    for (const probability of [0, 10, 100]) for (const draw of [0.09, 0.10, 0.11]) {
        let canonical = structuredClone(batchReadyValidV2);
        const settings = canonical.globalEnvelope.payload.scopes.chat.payload.dynamicsSettings;
        settings.incident = { ...settings.incident, enabled, probability };
        let randomCalls = 0, aiCalls = 0, commits = 0;
        let beforeGeneration;
        const permitted = enabled && (historical || probability === 100 || (probability === 10 && draw < 0.10));
        const controller = createTodayTrendGenerationController({ getCtx: () => ({}), gather: async () => ({}), now: () => 100,
            callAI: async (system, user) => {
                aiCalls++;
                beforeGeneration = structuredClone(canonical);
                if (historical) {
                    assert.match(user, /本批事故已发生/);
                    assert.match(system, permitted ? /只能根据本批 history_batch_data 明确发生的事实/ : /禁止新建 incident，包括历史事实补录/);
                    assert.doesNotMatch(system, /允许合理创建 incident|本轮允许在合理时创建 incident/);
                    if (permitted) assert.match(system, /不可主动推演或编造 incident/);
                } else {
                    assert.match(system, permitted ? /本轮允许在合理时创建 incident/ : /本轮不允许新建 type 为 incident/);
                    assert.doesNotMatch(system, /本轮允许补录 incident/);
                }
                const dto = batchEmpty();
                dto.dynamics.create.push({ ...createBatch.dynamics.create[0], id: 's1-incident', type: 'incident', relatedEventIds: [], initialStage: '本批事故已发生' });
                if (historical) return JSON.stringify(dto);
                const scope = buildReadOnlyShadow(canonical).scopes.chat;
                const materialized = materializeTodayTrendBatchDelta(dto, scope, 100);
                return JSON.stringify(materialized.parsed);
            } });
        const scheduler = createTodayTrendScheduler({ controller, getStorageId: () => 'chat',
            getChat: () => [{ role: 'assistant', content: '本批事故已发生' }],
            getStore: async () => buildReadOnlyShadow(canonical), random: () => { randomCalls++; return draw; },
            committer: { supportsCanonical: true, invalidateCommits() {}, loadCanonical: async () => structuredClone(canonical),
                commitStore: async mutate => { canonical = await mutate(structuredClone(canonical)); commits++; return buildReadOnlyShadow(canonical); } } });
        const run = () => scheduler.manual(historical ? { batchEnabled: true, recentAssistantCount: 1, mergeAssistantCount: 1 } : { floor: 8 });
        if (permitted) {
            await run();
            assert.ok(buildReadOnlyShadow(canonical).scopes.chat.dynamics.active.some(event => event.id === 's1-incident'));
        } else {
            await assert.rejects(run, /未允许生成突发事件/);
            assert.deepEqual(canonical, beforeGeneration, '权限失败不得写入部分候选');
        }
        assert.equal(aiCalls, 1);
        assert.equal(randomCalls, !historical && enabled && probability === 10 ? 1 : 0);
        assert.equal(commits, (historical ? 1 : 0) + (permitted ? 1 : 0), '历史启动重置与候选提交分开计数');
    }
}

const phase3BatchChat = Array.from({ length: 8 }, (_, index) => ({ role: 'assistant', content: `阶段3批次正文${index + 1}` }));
let phase3BatchCanonical = structuredClone(batchReadyValidV2);
let phase3BatchLoadCalls = 0;
let phase3BatchCommitCalls = 0;
const phase3BatchScopes = [];
const phase3BatchInputs = [];
const phase3BatchCounts = [];
const phase3BatchStates = [];
const phase3BatchCommitter = {
    supportsCanonical: true,
    invalidateCommits: () => {},
    loadCanonical: async () => { phase3BatchLoadCalls += 1; return structuredClone(phase3BatchCanonical); },
    commitStore: async (mutate, _task, options) => {
        assert.deepEqual(options, { canonical: true, scopeId: 'chat',
            expectedStoreRevision: phase3BatchCanonical.globalEnvelope.revision,
            expectedScopeRevision: phase3BatchCanonical.globalEnvelope.payload.scopes.chat.revision,
        }, '阶段3批处理每批必须冻结当前 canonical revision 后再提交');
        phase3BatchCommitCalls += 1;
        phase3BatchCanonical = await mutate(structuredClone(phase3BatchCanonical));
        return buildReadOnlyShadow(phase3BatchCanonical);
    },
};
const phase3BatchScheduler = createTodayTrendScheduler({
    controller: { generate: async input => {
        phase3BatchScopes.push(structuredClone(input.scope));
        phase3BatchInputs.push(input.historyBatch);
        phase3BatchCounts.push(input.assistantCount);
        const scope = structuredClone(input.scope);
        scope.world = { items: [{ id: `phase3-batch-world-${input.assistantCount}`, name: '当前批世界态势',
            summary: `阶段3批次${input.assistantCount}` }] };
        return { scope, history: { events: [] } };
    } },
    committer: phase3BatchCommitter, getStore: async () => buildReadOnlyShadow(phase3BatchCanonical),
    getStorageId: () => 'chat', getChat: () => phase3BatchChat, getFloor: () => 8,
});
const phase3BatchUnsubscribe = phase3BatchScheduler.subscribe(snapshot => {
    if (snapshot.task?.batchIndex !== undefined) phase3BatchStates.push({
        batchIndex: snapshot.task.batchIndex, batchCount: snapshot.task.batchCount,
    });
});
await phase3BatchScheduler.manual({ batchEnabled: true, recentAssistantCount: 8, mergeAssistantCount: 3 });
phase3BatchUnsubscribe();
assert.equal(phase3BatchInputs.length, 3, '阶段3合法窗口必须按合并大小串行调用三次 AI');
assert.deepEqual(phase3BatchCounts, [3, 6, 8], '阶段3每批提交边界必须使用当前批最后一个 assistant 序号');
assert.deepEqual(phase3BatchInputs.map(batch => batch.length), [3, 3, 2], '阶段3每批正文必须只包含当前批及其上下文消息');
assert.deepEqual(phase3BatchScopes.map(scope => scope.world.items.map(item => item.summary)), [
    [], ['阶段3批次3'], ['阶段3批次6'],
], '首批生成必须以已提交空 scope 为基线，后续批只能继承前一批已提交结果');
assert.equal(phase3BatchCommitCalls, 4, '阶段3必须先提交清空事务，再在每批成功后立即提交一次');
assert.equal(phase3BatchLoadCalls, 4, '阶段3必须在清空前和每个批次开始前重新读取 canonical scope');
assert.deepEqual([...new Set(phase3BatchStates.map(item => `${item.batchIndex}/${item.batchCount}`))], ['0/3', '1/3', '2/3'], '阶段3状态订阅必须发布当前批次进度');
assert.equal(phase3BatchCanonical.globalEnvelope.payload.scopes.chat.payload.operation.lastSuccessfulAssistantCount, 8,
    '阶段3最终成功边界必须落在最后短批的 assistant 末端');

let phase3InvalidStoreReads = 0;
let phase3InvalidAiCalls = 0;
const phase3InvalidScheduler = createTodayTrendScheduler({
    controller: { generate: async () => { phase3InvalidAiCalls += 1; return { scope: valid.scopes.chat }; } },
    committer: { invalidateCommits: () => {}, commitStore: async () => { throw new Error('不得写入'); } },
    getStore: async () => { phase3InvalidStoreReads += 1; return valid; }, getStorageId: () => 'chat',
    getChat: () => phase3BatchChat,
});
await assert.rejects(() => phase3InvalidScheduler.manual({ batchEnabled: true, recentAssistantCount: 0, mergeAssistantCount: 1 }),
    error => error?.code === 'TT_HISTORY_WINDOW_INVALID', '阶段3非法窗口必须 fail-closed');
assert.equal(phase3InvalidStoreReads, 0, '阶段3非法窗口不得读取 store');
assert.equal(phase3InvalidAiCalls, 0, '阶段3非法窗口不得调用 AI');

let phase3FailureCanonical = structuredClone(batchReadyValidV2);
let phase3FailureCalls = 0;
let phase3FailureCommits = 0;
const phase3FailureScopes = [];
const phase3FailureScheduler = createTodayTrendScheduler({
    controller: { generate: async input => {
        phase3FailureCalls += 1;
        if (phase3FailureCalls === 2) throw new Error('阶段3第二批失败');
        phase3FailureScopes.push(structuredClone(input.scope));
        const scope = structuredClone(input.scope);
        scope.world = { items: [{ id: `phase3-failure-world-${input.assistantCount}`, name: '当前批世界态势',
            summary: `已完成至第 ${input.assistantCount} 层` }] };
        return { scope, history: { events: [] } };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        loadCanonical: async () => structuredClone(phase3FailureCanonical),
        commitStore: async mutate => { phase3FailureCommits += 1; phase3FailureCanonical = await mutate(structuredClone(phase3FailureCanonical)); return buildReadOnlyShadow(phase3FailureCanonical); },
    },
    getStore: async () => buildReadOnlyShadow(phase3FailureCanonical), getStorageId: () => 'chat', getChat: () => phase3BatchChat,
});
await assert.rejects(() => phase3FailureScheduler.manual({ batchEnabled: true, recentAssistantCount: 8, mergeAssistantCount: 3 }), /阶段3第二批失败/,
    '阶段3批次失败必须向调用方报告');
assert.equal(phase3FailureCalls, 2, '阶段3第二批失败后不得请求第三批');
assert.equal(phase3FailureCommits, 2, '阶段3第二批失败后必须保留先行清空与第一批成功提交');
assert.equal(phase3FailureCanonical.globalEnvelope.payload.scopes.chat.payload.operation.lastSuccessfulAssistantCount, 3,
    '阶段3批次失败后 canonical 必须停留在最后成功边界');
assert.equal(resolveTodayTrendV2UiScope(phase3FailureCanonical, 'chat').world.items[0]?.summary, '已完成至第 3 层',
    '阶段3第二批失败后 UI scope 必须保留第一批成功提交的数据');
await phase3FailureScheduler.manual({ batchEnabled: true, recentAssistantCount: 5, mergeAssistantCount: 3 });
assert.equal(phase3FailureCommits, 4, '从第 4 层连续接续时不得再次提交清空事务，只能提交两个剩余批次');
assert.deepEqual(phase3FailureScopes.slice(1).map(scope => scope.world.items[0]?.summary), [
    '已完成至第 3 层', '已完成至第 6 层',
], '接续批处理必须以已成功 canonical 内容为首批基线，并逐批保留接续结果');
assert.equal(phase3FailureCanonical.globalEnvelope.payload.scopes.chat.payload.operation.lastSuccessfulAssistantCount, 8,
    '接续批处理必须推进到最后未更新的 assistant 边界');
assert.equal(resolveTodayTrendV2UiScope(phase3FailureCanonical, 'chat').world.items[0]?.summary, '已完成至第 8 层',
    '接续批处理完成后 UI scope 必须展示接续后的最终数据');
const phase3ContinuityCalls = phase3FailureCalls;
const phase3ContinuityCommits = phase3FailureCommits;
const phase3ContinuityBefore = structuredClone(phase3FailureCanonical);
await assert.rejects(() => phase3FailureScheduler.manual({ batchEnabled: true, recentAssistantCount: 3, mergeAssistantCount: 1 }),
    error => error?.code === 'TT_BATCH_CONTINUITY_INVALID', '非全量且未从已成功边界后一层开始的批处理必须 fail-closed');
assert.equal(phase3FailureCalls, phase3ContinuityCalls, '非连续批处理不得请求 AI');
assert.equal(phase3FailureCommits, phase3ContinuityCommits, '非连续批处理不得清空或提交 canonical 数据');
assert.deepEqual(phase3FailureCanonical, phase3ContinuityBefore, '非连续批处理失败后必须完整保留已有 canonical 数据');


let phase3RaceChat = Array.from({ length: 8 }, (_, index) => ({ role: 'assistant', content: `竞态批次正文${index + 1}` }));
let phase3RaceCanonical = structuredClone(batchReadyValidV2);
let phase3RaceRelease;
let phase3RaceCalls = 0;
let phase3RaceCommits = 0;
const phase3RaceScheduler = createTodayTrendScheduler({
    controller: { generate: async input => {
        phase3RaceCalls += 1;
        if (phase3RaceCalls === 1) await new Promise(resolve => { phase3RaceRelease = () => resolve(); });
        return { scope: input.scope };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        loadCanonical: async () => structuredClone(phase3RaceCanonical),
        commitStore: async mutate => {
            phase3RaceCommits += 1;
            phase3RaceCanonical = await mutate(structuredClone(phase3RaceCanonical));
            return buildReadOnlyShadow(phase3RaceCanonical);
        },
    },
    getStore: async () => buildReadOnlyShadow(phase3RaceCanonical), getStorageId: () => 'chat', getChat: () => phase3RaceChat,
});
const phase3RaceRun = phase3RaceScheduler.manual({ batchEnabled: true, recentAssistantCount: 8, mergeAssistantCount: 3 });
for (let index = 0; index < 20 && typeof phase3RaceRelease !== 'function'; index += 1) await Promise.resolve();
assert.equal(typeof phase3RaceRelease, 'function', '阶段3竞态测试必须等待第一批 AI 请求进入挂起态');
phase3RaceChat[0] = { ...phase3RaceChat[0], content: '竞态期间被修改的正文' };
phase3RaceRelease();
await assert.rejects(() => phase3RaceRun, error => error?.code === 'TT_HISTORY_WINDOW_INVALID', '阶段3生成期间聊天变化必须拒绝迟到批次');
assert.equal(phase3RaceCalls, 1, '阶段3聊天变化后不得继续请求下一批');
assert.equal(phase3RaceCommits, 2, '阶段3聊天变化只允许完成清空并尝试当前批提交，不能继续后续提交');
assert.equal(phase3RaceCanonical.globalEnvelope.payload.scopes.chat.payload.operation.lastSuccessfulAssistantCount, 0,
    '阶段3聊天变化后必须保留已提交的空内容边界，不能回显旧 canonical 内容');

let phase3CancelCanonical = structuredClone(batchReadyValidV2);
let phase3CancelRelease;
let phase3CancelCalls = 0;
const phase3CancelScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => {
        phase3CancelCalls += 1;
        await new Promise(resolve => { phase3CancelRelease = resolve; });
        const generatedScope = structuredClone(scope);
        generatedScope.world = { items: [{ id: 'phase3-cancel-world', name: '迟到世界态势', summary: '取消后不得回显的旧内容' }] };
        return { scope: generatedScope, history: { events: [] } };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        loadCanonical: async () => structuredClone(phase3CancelCanonical),
        commitStore: async mutate => {
            phase3CancelCanonical = await mutate(structuredClone(phase3CancelCanonical));
            return buildReadOnlyShadow(phase3CancelCanonical);
        },
    },
    getStore: async () => buildReadOnlyShadow(phase3CancelCanonical), getStorageId: () => 'chat',
    getChat: () => phase3BatchChat,
});
const phase3CancelRun = phase3CancelScheduler.manual({ batchEnabled: true, recentAssistantCount: 8, mergeAssistantCount: 3 });
for (let index = 0; index < 20 && typeof phase3CancelRelease !== 'function'; index += 1) await Promise.resolve();
assert.equal(typeof phase3CancelRelease, 'function', '阶段3取消测试必须等待首批 AI 请求进入挂起态');
assert.deepEqual(resolveTodayTrendV2UiScope(phase3CancelCanonical, 'chat').world.items, [],
    '首批挂起期间批量任务必须已经提交空 canonical 内容');
phase3CancelScheduler.cancel('phase-3-batch-cancel');
phase3CancelRelease();
await assert.rejects(() => phase3CancelRun, error => error?.name === 'AbortError',
    '首批挂起后取消批量任务必须以 AbortError 终止');
assert.equal(phase3CancelCalls, 1, '首批取消后不得继续请求后续批次');
assert.deepEqual(resolveTodayTrendV2UiScope(phase3CancelCanonical, 'chat').world.items, [],
    '首批取消及迟到结果释放后 canonical 必须保持空内容，不能回显旧批次');

let phase3InitialBatchCanonical = structuredClone(migratedValidV2);
let phase3InitialBatchAiCalls = 0;
const phase3InitialBatchScheduler = createTodayTrendScheduler({
    controller: { generate: async input => {
        phase3InitialBatchAiCalls += 1;
        const scope = structuredClone(input.scope);
        scope.world = { items: [{ id: `phase3-initial-world-${input.assistantCount}`, name: '当前批世界态势',
            summary: `首次批量第 ${input.assistantCount} 层` }] };
        return { scope, history: { events: [] } };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        loadCanonical: async () => structuredClone(phase3InitialBatchCanonical),
        commitStore: async mutate => {
            const candidate = await mutate(structuredClone(phase3InitialBatchCanonical));
            phase3InitialBatchCanonical = validateTodayTrendV2Transition(phase3InitialBatchCanonical, candidate);
            return buildReadOnlyShadow(phase3InitialBatchCanonical);
        },
    },
    getStore: async () => buildReadOnlyShadow(phase3InitialBatchCanonical), getStorageId: () => 'chat',
    getChat: () => Array.from({ length: 2 }, () => ({ role: 'assistant', content: '首次批量正文' })),
});
await phase3InitialBatchScheduler.manual({ batchEnabled: true, recentAssistantCount: 2, mergeAssistantCount: 2 });
assert.equal(phase3InitialBatchAiCalls, 1, '迁移后的初始 scope 必须允许首次批量生成');
assert.equal(phase3InitialBatchCanonical.globalEnvelope.payload.scopes.chat.payload.operation.lastSuccessfulAssistantCount, 2,
    '首次批量生成必须推进成功边界');
assert.deepEqual(phase3InitialBatchCanonical.globalEnvelope.payload.scopes.chat.payload.generationSnapshots
    .map(snapshot => [snapshot.assistantCount, snapshot.restoreCapability]), [[0, 'full'], [2, 'full']],
    '首次批量生成必须在同一提交中保留 floor 0 与首批的完整 checkpoint');

const phase3RuntimeBatchFixture = Object.freeze({ assistantCount: 107, recentAssistantCount: 107, mergeAssistantCount: 4 });
let phase3RuntimeBatchCanonical = structuredClone(migratedValidV2);
let phase3RuntimeBatchAiCalls = 0;
const phase3RuntimeBatchScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => {
        phase3RuntimeBatchAiCalls += 1;
        return { scope, history: { events: [] } };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        loadCanonical: async () => structuredClone(phase3RuntimeBatchCanonical),
        commitStore: async mutate => {
            const candidate = await mutate(structuredClone(phase3RuntimeBatchCanonical));
            phase3RuntimeBatchCanonical = validateTodayTrendV2Transition(phase3RuntimeBatchCanonical, candidate);
            return buildReadOnlyShadow(phase3RuntimeBatchCanonical);
        },
    },
    getStore: async () => buildReadOnlyShadow(phase3RuntimeBatchCanonical), getStorageId: () => 'chat',
    getChat: () => Array.from({ length: phase3RuntimeBatchFixture.assistantCount }, () => ({ role: 'assistant', content: '运行时批处理正文' })),
});
await phase3RuntimeBatchScheduler.manual({ batchEnabled: true,
    recentAssistantCount: phase3RuntimeBatchFixture.recentAssistantCount,
    mergeAssistantCount: phase3RuntimeBatchFixture.mergeAssistantCount,
});
assert.equal(phase3RuntimeBatchAiCalls,
    Math.ceil(phase3RuntimeBatchFixture.recentAssistantCount / phase3RuntimeBatchFixture.mergeAssistantCount),
    '批处理次数必须由运行时 R/M 计算，不得使用固定夹具批数');
assert.equal(phase3RuntimeBatchCanonical.globalEnvelope.payload.scopes.chat.payload.operation.lastSuccessfulAssistantCount,
    phase3RuntimeBatchFixture.assistantCount, '运行时 C/R/M 批处理必须推进到真实聊天末楼层');

assert.deepEqual(describeTodayTrendLegacyBatchBaselineEligibility(migratedValidV2, 'chat'), { eligible: true, reason: null },
    '纯迁移 projection scope 必须被识别为可安全补建 floor 0 checkpoint');

const phase3RemovedLegacyCanonical = structuredClone(migratedValidV2);
const phase3RemovedLegacyPayload = phase3RemovedLegacyCanonical.globalEnvelope.payload.scopes.chat.payload;
phase3RemovedLegacyPayload.removableEntityTombstonesById = {
    'day:service:2025-04-15': {
        entityType: 'day-summary', entityId: 'day:service:2025-04-15', eventId: 'service', state: 'removed',
        removalReason: 'archived-retention', removedAtAssistantCount: 2, policyRevision: 1,
    },
};
phase3RemovedLegacyPayload.removableEntityStateById = structuredClone(phase3RemovedLegacyPayload.removableEntityTombstonesById);
assert.deepEqual(describeTodayTrendLegacyBatchBaselineEligibility(phase3RemovedLegacyCanonical, 'chat'), {
    eligible: false, reason: 'removable-entity-state-not-empty',
}, '含 removed lifecycle 的迁移 scope 不得被自动补建为 floor 0 checkpoint');

const assertLegacyBatchBaselineReason = (store, reason, message) => assert.deepEqual(
    describeTodayTrendLegacyBatchBaselineEligibility(store, 'chat'), { eligible: false, reason }, message,
);
const phase3NoSnapshotLegacyCanonical = structuredClone(migratedValidV2);
phase3NoSnapshotLegacyCanonical.globalEnvelope.payload.scopes.chat.payload.generationSnapshots = [];
assertLegacyBatchBaselineReason(phase3NoSnapshotLegacyCanonical, 'snapshot-missing',
    '空迁移快照不得自动补建 floor 0 checkpoint');
const phase3NoFloorZeroLegacyCanonical = structuredClone(migratedValidV2);
phase3NoFloorZeroLegacyCanonical.globalEnvelope.payload.scopes.chat.payload.generationSnapshots[0].assistantCount = 1;
assertLegacyBatchBaselineReason(phase3NoFloorZeroLegacyCanonical, 'floor-zero-snapshot-missing',
    '没有既有 floor 0 快照不得从当前 scope 伪造 checkpoint');
assertLegacyBatchBaselineReason(batchBaselineValidV2, 'snapshot-not-projection-only',
    '已有 full snapshot 的 canonical scope 不得被误认作 legacy projection baseline');
assertLegacyBatchBaselineReason(normalizedPhase4Available, 'stage-details-not-empty',
    '已保留 stage detail 的 scope 不得自动补建 floor 0 checkpoint');
assertLegacyBatchBaselineReason(normalizedPhase4Manifest, 'archived-removable-data-not-empty',
    '已保留 archived removable data 的 scope 不得自动补建 floor 0 checkpoint');
const phase3RetentionLegacyCanonical = structuredClone(migratedValidV2);
phase3RetentionLegacyCanonical.globalEnvelope.payload.scopes.chat.payload.historyRetentionSettings.archivedDetailRetentionFloors = 21;
assertLegacyBatchBaselineReason(phase3RetentionLegacyCanonical, 'retention-settings-not-default',
    '非默认 retention 设置的 scope 不得自动补建 floor 0 checkpoint');
const phase3DetailPoolLegacyCanonical = structuredClone(migratedValidV2);
phase3DetailPoolLegacyCanonical.globalEnvelope.payload.scopes.chat.payload.historyRetentionState.detailPoolRevision = 1;
assertLegacyBatchBaselineReason(phase3DetailPoolLegacyCanonical, 'detail-pool-revised',
    '已变更 detail pool 的 scope 不得自动补建 floor 0 checkpoint');
const phase3RetentionPolicyLegacyCanonical = structuredClone(migratedValidV2);
phase3RetentionPolicyLegacyCanonical.globalEnvelope.payload.scopes.chat.payload.historyRetentionState.retentionPolicyRevision = 2;
assertLegacyBatchBaselineReason(phase3RetentionPolicyLegacyCanonical, 'retention-policy-revised',
    '已变更 retention policy 的 scope 不得自动补建 floor 0 checkpoint');
const phase3SequenceLegacyCanonical = structuredClone(migratedValidV2);
phase3SequenceLegacyCanonical.globalEnvelope.payload.scopes.chat.payload.historyRetentionState.nextArchivedSequence += 1;
assertLegacyBatchBaselineReason(phase3SequenceLegacyCanonical, 'archived-sequence-inconsistent',
    '归档序号不连续的 scope 不得自动补建 floor 0 checkpoint');

let phase3ReorderedCanonical = structuredClone(batchReadyValidV2);

phase5ChainAuthority.close();

const phase6RemovedState = (id, eventId = 'service') => ({
    entityType: 'day-summary', entityId: id, eventId, state: 'removed', removalReason: 'period-compaction',
    removedAtAssistantCount: 40, policyRevision: 1,
});
const phase6Period = (sequence, sourceStageStart, childSummaryRefs, summary = `时期摘要${sequence}`, sourceStageEnd = sourceStageStart) => ({
    id: `period:service:${sequence}`, kind: 'period-summary', periodSequence: sequence,
    startDate: '2025-04-01', startTime: null, endDate: '2025-04-02', endTime: null, summary,
    childSummaryRefs, childSummaryCount: childSummaryRefs.length, historicalDetailCount: childSummaryRefs.length,
    sourceStageStart, sourceStageEnd, revision: 1,
});
const phase6Day = (date, sourceStageStart, summary = `日摘要${date}`) => ({
    id: `day:service:${date}`, kind: 'day-summary', status: 'closed', storyDate: date,
    timeRange: { start: null, end: null, label: '全天' }, summary, keyStages: ['service'], detailRefs: [], detailCount: 0,
    sourceStageStart, sourceStageEnd: sourceStageStart, sourceFloorStart: 40, sourceFloorEnd: 40, revision: 1,
});
const phase6StoreWithStages = stages => {
    const store = structuredClone(migratedValidV2);
    const payload = store.globalEnvelope.payload.scopes.chat.payload;
    const event = payload.dynamics.active.find(item => item.id === 'service');
    event.stages = structuredClone(stages);
    event.latestStage = stages.at(-1).summary ?? stages.at(-1).text;
    event.capacityCompatibilityPending = stages.length === 40;
    payload.stageDetailsByEvent.service = [];
    payload.removableEntityStateById = Object.fromEntries(Object.entries(payload.removableEntityStateById)
        .filter(([, state]) => state.eventId !== 'service'));
    payload.removableEntityTombstonesById = Object.fromEntries(Object.entries(payload.removableEntityTombstonesById)
        .filter(([, state]) => state.eventId !== 'service'));
    for (const stage of stages) {
        if (stage.kind === 'day-summary') {
            payload.removableEntityStateById[stage.id] = {
                entityType: 'day-summary', entityId: stage.id, eventId: 'service', state: 'available',
                removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
            };
        }
        if (stage.kind === 'period-summary') for (const ref of stage.childSummaryRefs) {
            const state = phase6RemovedState(ref);
            payload.removableEntityStateById[ref] = state;
            payload.removableEntityTombstonesById[ref] = structuredClone(state);
        }
    }
    return normalizeTodayTrendV2Candidate(store);
};
const phase6DirectApply = (store, producer, assistantCount = 61) => {
    const payload = store.globalEnvelope.payload.scopes.chat.payload;
    return applyTodayTrendHistoryProducer(payload, producer, {
        trustedStoryDate: null, assistantCount, previousPayload: payload,
    });
};

const phase6FortyStages = Array.from({ length: 40 }, (_, index) =>
    phase6Period(index + 1, index + 1, [`day:service:removed-${index + 1}`]));
const phase6Admission40 = phase6StoreWithStages(phase6FortyStages);
assert.equal(phase6Admission40.globalEnvelope.payload.scopes.chat.payload.dynamics.active
    .find(event => event.id === 'service').capacityCompatibilityPending, true,
'阶段 6 schema admission 必须继续允许 40 条兼容历史');
const phase6Compacted40 = phase6DirectApply(phase6Admission40, phase5Producer('service', []));
const phase6Compacted40Event = phase6Compacted40.dynamics.active.find(event => event.id === 'service');
assert.equal(phase6Compacted40Event.stages.length, 39, '涉及 40 条兼容历史的新事务必须压缩到不超过 39');
assert.equal(phase6Compacted40Event.capacityCompatibilityPending, false, '成功 mutation 必须清除容量兼容标记');
assert.equal(phase6Compacted40Event.stages[0].kind, 'period-summary', '强制压缩必须生成 period projection');
assert.deepEqual(phase6Compacted40Event.stages[0].childSummaryRefs,
    ['day:service:removed-1', 'day:service:removed-2'], 'period+period 合并必须保留扁平 day refs');

const phase6NoCandidateStages = [
    ...Array.from({ length: 39 }, (_, index) => ({
        id: `legacy:service:${String(index + 1).padStart(4, '0')}`, kind: 'legacy-stage', text: `旧阶段${index + 1}`,
        legacyIndex: index, sourceStageStart: index + 1, sourceStageEnd: index + 1, revision: 1,
    })),
    phase6Period(1, 40, ['day:service:removed-only']),
];
const phase6NoCandidate = phase6StoreWithStages(phase6NoCandidateStages);
assert.throws(() => phase6DirectApply(phase6NoCandidate, phase5Producer('service', [])),
    error => error?.code === 'TT_CAPACITY_NO_COMPACTION_CANDIDATE',
    '40 条历史没有连续 closed summary candidate 时必须整单阻塞');
const phase6RealNoCandidateStages = phase6NoCandidateStages.slice(0, 39);
const phase6RealNoCandidateStore = phase6StoreWithStages(phase6RealNoCandidateStages);
const phase6RealNoCandidateBefore = JSON.stringify(phase6RealNoCandidateStore);
assert.throws(() => applyTodayTrendGenerationToV2(phase6RealNoCandidateStore, 'chat',
    phase5GeneratedScope(phase6RealNoCandidateStore, '无法压缩的新进展'),
    phase5Producer('service', [phase5Stage('无法压缩的新进展')]), {
        trustedStoryDate: null, assistantCount: 63, generatedAt: 9300,
    }), error => error?.code === 'TT_CAPACITY_NO_COMPACTION_CANDIDATE',
'真实 apply 路径追加第 40 条后没有 closed summary candidate 时必须整单阻塞');
assert.equal(JSON.stringify(phase6RealNoCandidateStore), phase6RealNoCandidateBefore,
    '真实 apply 容量失败不得修改输入 canonical store');

const phase6MissingLifecycle = phase6StoreWithStages([
    phase6Day('2025-04-01', 1), phase6Day('2025-04-02', 2),
    ...Array.from({ length: 38 }, (_, index) => phase6Period(index + 1, index + 3, [`day:service:lifecycle-${index + 1}`])),
]);
delete phase6MissingLifecycle.globalEnvelope.payload.scopes.chat.payload.removableEntityStateById['day:service:2025-04-01'];
assert.throws(() => phase6DirectApply(phase6MissingLifecycle, phase5Producer('service', [])),
    error => error?.code === 'TT_HISTORY_SCHEMA_INVALID', 'period compaction 缺少 day-summary lifecycle state 时必须 fail closed');

for (const count of [35, 36, 37, 38, 39]) {
    const stages = Array.from({ length: count }, (_, index) =>
        phase6Period(index + 1, index + 1, [`day:service:optional-${index + 1}`]));
    const store = phase6StoreWithStages(stages);
    const result = phase6DirectApply(store, phase5Producer('service', []));
    assert.equal(result.dynamics.active.find(event => event.id === 'service').stages.length, count,
        `无 AI 精确匹配时 ${count} 条历史不得可选折叠`);
}

const phase6OptionalFixture = count => {
    const store = phase6StoreWithStages(Array.from({ length: count }, (_, index) =>
        phase6Period(index + 1, index + 1, [`day:service:optional-ai-${index + 1}`])));
    const payload = structuredClone(store.globalEnvelope.payload.scopes.chat.payload);
    const template = payload.dynamics.active.find(event => event.id === 'service');
    const auxiliaryIds = Array.from({ length: 6 }, (_, index) => `phase6-aux-${count}-${index + 1}`);
    auxiliaryIds.forEach((eventId, index) => payload.dynamics.active.push({
        ...structuredClone(template), id: eventId, title: `辅助事件${count}-${index + 1}`,
        stages: [{
            id: `live:${eventId}:1`, kind: 'live-stage', storyDate: '2025-04-03', time: null, timeLabel: null,
            text: `辅助进展${index + 1}`, sourceStageStart: 1, sourceStageEnd: 1,
            sourceFloorStart: 61, sourceFloorEnd: 61, revision: 1,
        }], latestStage: `辅助进展${index + 1}`, capacityCompatibilityPending: false,
    }));
    const exactSummary = {
        summaryText: `AI 精确时期摘要 ${count}`, startDate: '2025-04-01', endDate: '2025-04-02',
        childSummaryRefs: ['day:service:optional-ai-1', 'day:service:optional-ai-2'],
    };
    const producer = summary => ({ events: [
        { eventId: 'service', stages: [], daySummaries: [], periodSummaries: [summary] },
        ...auxiliaryIds.slice(0, 3).map((eventId, index) => ({
            eventId, stages: [], daySummaries: [{ summaryText: `限额占位${index + 1}`, keyStages: [eventId] }], periodSummaries: [],
        })),
    ] });
    return { payload, exactSummary, producer };
};
for (const count of [36, 37, 38]) {
    const { payload, exactSummary, producer } = phase6OptionalFixture(count);
    const matched = applyTodayTrendHistoryProducer(payload, producer(exactSummary),
        { trustedStoryDate: '2025-04-04', assistantCount: 62, previousPayload: payload });
    assert.equal(matched.dynamics.active.find(event => event.id === 'service').stages.length, count - 1,
        `${count} 条历史存在 exact AI 匹配时必须恰好折叠一次`);
    const mismatch = { ...exactSummary, endDate: '2025-04-03' };
    const unmatched = applyTodayTrendHistoryProducer(payload, producer(mismatch),
        { trustedStoryDate: '2025-04-04', assistantCount: 62, previousPayload: payload });
    assert.equal(unmatched.dynamics.active.find(event => event.id === 'service').stages.length, count,
        `${count} 条历史没有 exact AI 匹配时必须保持原长度`);
}

const phase6DayStages = [phase6Day('2025-04-01', 1), phase6Day('2025-04-02', 2),
    phase6Period(1, 3, ['day:service:removed-tail'])];
const phase6DayStore = phase6StoreWithStages([
    ...phase6DayStages,
    ...Array.from({ length: 37 }, (_, index) => phase6Period(index + 2, index + 4, [`day:service:tail-${index + 1}`])),
]);
const phase6DayResult = phase6DirectApply(phase6DayStore, phase5Producer('service', []), 77);
const phase6DayResultPayload = phase6DayResult;
const phase6DayResultEvent = phase6DayResultPayload.dynamics.active.find(event => event.id === 'service');
assert.ok(phase6DayResultEvent.stages.length <= 39, '必要时 planner 必须执行确定性的多轮压缩');
assert.deepEqual(phase6DayResultEvent.stages[0].childSummaryRefs,
    ['day:service:2025-04-01', 'day:service:2025-04-02'], 'day+day 合并必须保留原始 day refs');
for (const id of ['day:service:2025-04-01', 'day:service:2025-04-02']) {
    const state = phase6DayResultPayload.removableEntityStateById[id];
    assert.deepEqual(state, phase6DayResultPayload.removableEntityTombstonesById[id],
        '被 period 替换的 day-summary 必须写入一致 removed state/tombstone');
    assert.equal(state.removalReason, 'period-compaction', 'day-summary 删除原因必须是 period-compaction');
    assert.equal(state.removedAtAssistantCount, 77, 'removedAtAssistantCount 必须使用有效 assistantCount');
}

const phase6MultiRoundStages = [
    phase6Period(1, 1, ['day:service:multi-a']), phase6Period(2, 2, ['day:service:multi-b']),
    { id: 'legacy:service:0003', kind: 'legacy-stage', text: '第一候选边界', legacyIndex: 2,
        sourceStageStart: 3, sourceStageEnd: 3, revision: 1 },
    phase6Period(3, 4, ['day:service:multi-c']), phase6Period(4, 5, ['day:service:multi-d']),
    ...Array.from({ length: 35 }, (_, index) => ({
        id: `legacy:service:${String(index + 6).padStart(4, '0')}`, kind: 'legacy-stage', text: `多轮既有阶段 ${index + 1}`,
        legacyIndex: index + 5, sourceStageStart: index + 6, sourceStageEnd: index + 6, revision: 1,
    })),
];
const phase6MultiRoundBase = phase6StoreWithStages(phase6MultiRoundStages);
const phase6MultiRoundPrevious = phase6MultiRoundBase.globalEnvelope.payload.scopes.chat.payload;
const phase6MultiRoundPayload = structuredClone(phase6MultiRoundPrevious);
const phase6MultiRoundCandidateEvent = phase6MultiRoundPayload.dynamics.active.find(event => event.id === 'service');
phase6MultiRoundCandidateEvent.stages.push({
    id: 'undated:service:1', kind: 'undated-stage', storyDate: null, time: null, timeLabel: null, text: '事务内新增阶段',
    undatedSequence: 1, sourceStageStart: 41, sourceStageEnd: 41, sourceFloorStart: 78, sourceFloorEnd: 78, revision: 1,
});
phase6MultiRoundCandidateEvent.latestStage = '事务内新增阶段';
const phase6MultiRoundBeforeMax = 4;
const phase6MultiRoundResult = applyTodayTrendHistoryProducer(phase6MultiRoundPayload,
    phase5Producer('service', [phase5Stage('事务内新增阶段')]), {
        trustedStoryDate: null, assistantCount: 78, previousPayload: phase6MultiRoundPrevious,
    });
const phase6MultiRoundEvent = phase6MultiRoundResult.dynamics.active.find(event => event.id === 'service');
const phase6MultiRoundSequences = phase6MultiRoundEvent.stages.filter(stage => stage.kind === 'period-summary')
    .map(stage => stage.periodSequence);
assert.ok(Math.max(...phase6MultiRoundSequences) >= phase6MultiRoundBeforeMax + 2,
    '合法 40 条 previousPayload 加一条事务内 incoming 时，两个隔离二元候选必须驱动至少两轮压缩');
assert.equal(phase6MultiRoundEvent.stages.length, 39, '多轮压缩完成后必须满足成功 mutation 的 39 条后置条件');

const phase6RealApplyBase = phase6StoreWithStages([
    phase6Day('2025-04-01', 1), phase6Day('2025-04-02', 2),
    ...Array.from({ length: 37 }, (_, index) => phase6Period(index + 1, index + 3, [`day:service:real-${index + 1}`])),
]);
const phase6RealApplied = applyTodayTrendGenerationToV2(phase6RealApplyBase, 'chat',
    phase5GeneratedScope(phase6RealApplyBase, '真实 apply 新增进展'),
    phase5Producer('service', [phase5Stage('真实 apply 新增进展')]), {
        trustedStoryDate: null, assistantCount: 79, generatedAt: 9400,
    });
const phase6RealPayload = phase6RealApplied.globalEnvelope.payload.scopes.chat.payload;
const phase6RealEvent = phase6RealPayload.dynamics.active.find(event => event.id === 'service');
assert.ok(phase6RealEvent.stages.length <= 39, '真实 apply/normalize 链追加 stage 后必须强制压缩到 39 条以内');
assert.equal(phase6RealEvent.capacityCompatibilityPending, false, '真实 apply/normalize 成功后必须清除容量兼容标记');
const phase6RealPeriod = phase6RealEvent.stages.find(stage => stage.kind === 'period-summary'
    && stage.childSummaryRefs.includes('day:service:2025-04-01'));
assert.deepEqual(phase6RealPeriod?.childSummaryRefs, ['day:service:2025-04-01', 'day:service:2025-04-02'],
    '真实 apply 必须持久化 planner 生成的 period projection 与精确 child refs');
for (const id of phase6RealPeriod.childSummaryRefs) {
    assert.equal(phase6RealPayload.removableEntityStateById[id].state, 'removed', '真实 apply 必须关闭被折叠 day state');
    assert.deepEqual(phase6RealPayload.removableEntityStateById[id], phase6RealPayload.removableEntityTombstonesById[id],
        '真实 apply 必须同步写入 removed state/tombstone');
}

const phase6ReducerSource = await readFile(new URL('../src/today-trend-history-reducer.js', import.meta.url), 'utf8');
const phase6ComparatorSource = phase6ReducerSource.match(/candidates\.sort\(\(left, right\) => \{([\s\S]*?)\n\s{4}\}\);/)?.[1] || '';
assert.match(phase6ComparatorSource, /left\.children\.length - right\.children\.length/,
    '候选 comparator 必须按 candidate projection child 数排序');
assert.doesNotMatch(phase6ComparatorSource, /childSummaryRefs\.length/,
    '候选 comparator 不得退化为按 flattened day ref 数排序');

const phase6TieBreakStages = [
    phase6Period(1, 1, ['day:service:tie-a']), phase6Period(2, 2, ['day:service:tie-b']),
    phase6Period(3, 3, ['day:service:tie-c']), phase6Period(4, 4, ['day:service:tie-d']),
    ...Array.from({ length: 36 }, (_, index) => ({
        id: `legacy:service:${String(index + 5).padStart(4, '0')}`, kind: 'legacy-stage', text: `tie legacy ${index + 1}`,
        legacyIndex: index + 4, sourceStageStart: index + 5, sourceStageEnd: index + 5, revision: 1,
    })),
];
const phase6TieBreakResult = phase6DirectApply(phase6StoreWithStages(phase6TieBreakStages), phase5Producer('service', []));
const phase6TieBreakWinner = phase6TieBreakResult.dynamics.active.find(event => event.id === 'service').stages[0];
assert.equal(phase6TieBreakWinner.sourceStageStart, 1, '候选排序必须优先最早 sourceStageStart');
assert.equal(phase6TieBreakWinner.sourceStageEnd, 2, '同起点且均满足 requiredGain 时必须优先最少 projection children');
assert.deepEqual(phase6TieBreakWinner.childSummaryRefs, ['day:service:tie-a', 'day:service:tie-b'],
    'tie-break 胜者必须是最早起点的两个 projection candidate，而不是更长候选');
// 对合法、连续且 source 区间不重叠的线性 stage 列表，同起点与 projection child 数已唯一确定 end 与 sortId；
// sourceStageEnd/sortId 层级只能作为防御性稳定排序，无法构造独立可达反例而不破坏持久化 schema。

const phase6ChainHarness = createAuthorityHarness();
const phase6ChainCasWrites = [];
const phase6ChainAuthority = createTodayTrendV2Authority({
    readEntry: phase6ChainHarness.readEntry,
    compareAndSwap: async request => {
        phase6ChainCasWrites.push(request.writes.map(entry => entry.key));
        return phase6ChainHarness.compareAndSwap(request);
    },
    tabId: 'phase-6-chain-owner', BroadcastChannelImpl: undefined,
});
await phase6ChainAuthority.acquire({ readV2: true, writeV2: true, initialStore: phase6RealApplyBase });
let phase6ChainNow = 9500;
const phase6ChainPhases = [];
const phase6ChainJournal = createTodayTrendJournal({
    listKeys: async () => [...phase6ChainHarness.records.keys()], readEntry: phase6ChainHarness.readEntry,
    writeEntry: async (key, value) => {
        phase6ChainHarness.records.set(key, structuredClone(value));
        phase6ChainPhases.push(value.phase);
        return true;
    },
    deleteEntry: async key => phase6ChainHarness.records.delete(key), now: () => ++phase6ChainNow,
    transactionId: () => `phase-6-chain-${phase6ChainNow}`,
});
const phase6ChainStorage = createTodayTrendStorage({
    v2Authority: phase6ChainAuthority, journal: phase6ChainJournal, storage: memoryStorage(),
});
const phase6ChainRefreshes = [];
const phase6ChainCommitter = createTodayTrendCommitter({
    runtime: {}, load: phase6ChainStorage.load, loadCanonical: phase6ChainStorage.loadCanonical,
    save: phase6ChainStorage.save, storageStatus: phase6ChainStorage.status, journal: phase6ChainJournal,
    refreshInjection: async store => { phase6ChainRefreshes.push(structuredClone(store)); return { failedWrites: 0, failedKeys: [] }; },
});
let phase6ChainAiCalls = 0;
const phase6ChainController = createTodayTrendGenerationController({
    getCtx: () => ({}), gather: async () => collectedContext,
    callAI: async () => {
        phase6ChainAiCalls += 1;
        const dynamics = structuredClone(buildReadOnlyShadow(phase6RealApplyBase).scopes.chat.dynamics);
        const service = dynamics.active.find(event => event.id === 'service');
        service.stages.push('阶段 6 完整链新增进展');
        service.latestStage = '阶段 6 完整链新增进展';
        return JSON.stringify({
            world: null, reputation: null, factions: null, dynamics,
            history: phase5Producer('service', [phase5Stage('阶段 6 完整链新增进展')]),
        });
    },
});
const phase6ChainScheduler = createTodayTrendScheduler({
    controller: phase6ChainController, committer: phase6ChainCommitter, getStore: phase6ChainStorage.load,
    getStorageId: () => 'chat', getCalendarStore: () => ({ version: 1, scopes: { chat: { baseDate: null } } }),
    getFloor: () => 81, now: () => 9600,
});
await phase6ChainScheduler.manual();
assert.equal(phase6ChainAiCalls, 1, '阶段 6 scheduler→committer→authority 链只能调用一次 AI transport');
const phase6ChainPersisted = (await phase6ChainAuthority.load()).v2Store.globalEnvelope.payload.scopes.chat.payload;
const phase6ChainEvent = phase6ChainPersisted.dynamics.active.find(event => event.id === 'service');
assert.ok(phase6ChainEvent.stages.length <= 39, '阶段 6 完整持久化链必须把新增后的历史压缩到 39 条以内');
assert.equal(phase6ChainEvent.capacityCompatibilityPending, false, '阶段 6 完整持久化链必须清除容量兼容标记');
for (const id of ['day:service:2025-04-01', 'day:service:2025-04-02']) {
    assert.equal(phase6ChainPersisted.removableEntityStateById[id].state, 'removed', '阶段 6 完整链必须持久化 removed state');
    assert.deepEqual(phase6ChainPersisted.removableEntityStateById[id], phase6ChainPersisted.removableEntityTombstonesById[id],
        '阶段 6 完整链必须持久化闭合 state/tombstone');
}
assert.equal(phase6ChainCasWrites.filter(keys => keys.length === 3 && keys.includes(TODAY_TREND_V2_STORAGE_KEY)
    && keys.includes(TODAY_TREND_V2_AUTHORITY_KEY) && keys.some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX))).length, 1,
'阶段 6 完整链必须恰好一次 canonical store/authority/journal CAS');
assert.ok(phase6ChainPhases.includes('accepted'), '阶段 6 完整链 journal 必须到达 accepted');
assert.equal([...phase6ChainHarness.records.keys()].some(key => key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX)), false,
    '阶段 6 完整链 accepted 后不得残留开放 journal');
assert.equal(phase6ChainRefreshes.length, 1, '阶段 6 完整链成功后必须只刷新一次');
assert.equal(await phase6ChainAuthority.release({ readV2: true, serveV2: false }), true, '阶段 6 完整链必须释放 authority owner');
phase6ChainAuthority.close();

const phase7DetailState = (id, eventId = 'service') => ({
    entityType: 'detail', entityId: id, eventId, state: 'available',
    removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
});
const phase7CapacityPayload = ({ detailCount, summarizedCount = detailCount, storyDate = '2025-04-01' }) => {
    const payload = structuredClone(phase5NextPayload);
    const event = payload.dynamics.active.find(item => item.id === 'service');
    const details = Array.from({ length: detailCount }, (_, index) => ({
        id: `detail:service:${index + 1}`, sourceStageSequence: index + 1,
        text: `容量详情${index + 1}`, storyDate,
    }));
    const refs = details.slice(0, summarizedCount).map(detail => detail.id);
    event.stages = [{
        id: `day:service:${storyDate}`, kind: 'day-summary', status: 'closed', storyDate,
        timeRange: { start: null, end: null, label: '全天' }, summary: '容量日摘要', keyStages: ['service'],
        detailRefs: refs, detailCount, sourceStageStart: 1, sourceStageEnd: detailCount,
        sourceFloorStart: 1, sourceFloorEnd: detailCount, revision: 1,
    }];
    event.latestStage = '容量日摘要';
    event.capacityCompatibilityPending = false;
    payload.stageDetailsByEvent.service = details;
    delete payload.archivedRemovableDataByEvent.service;
    payload.removableEntityStateById = Object.fromEntries(Object.entries(payload.removableEntityStateById)
        .filter(([, state]) => state.eventId !== 'service'));
    payload.removableEntityTombstonesById = Object.fromEntries(Object.entries(payload.removableEntityTombstonesById)
        .filter(([, state]) => state.eventId !== 'service'));
    payload.removableEntityStateById[event.stages[0].id] = {
        entityType: 'day-summary', entityId: event.stages[0].id, eventId: 'service', state: 'available',
        removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
    };
    for (const detail of details) payload.removableEntityStateById[detail.id] = phase7DetailState(detail.id);
    return payload;
};
const phase7Apply = (payload, assistantCount = 90) => applyTodayTrendHistoryProducer(payload,
    phase5Producer('service', []), { trustedStoryDate: null, assistantCount, previousPayload: payload });

const phase7AtLimit = phase7CapacityPayload({ detailCount: 80 });
const phase7AtLimitResult = phase7Apply(phase7AtLimit);
assert.equal(phase7AtLimitResult.stageDetailsByEvent.service.length, 80, '每 event 恰好 80 条 detail 时不得清理');
assert.equal(phase7AtLimitResult.historyRetentionState.detailPoolRevision,
    phase7AtLimit.historyRetentionState.detailPoolRevision, '未改变 detail pool 时不得递增 revision');

for (const detailCount of [81, 160]) {
    const payload = phase7CapacityPayload({ detailCount });
    const beforeRevision = payload.historyRetentionState.detailPoolRevision;
    const result = phase7Apply(payload, 91);
    assert.equal(result.stageDetailsByEvent.service, undefined, `单个已摘要完整日期含 ${detailCount} 条 detail 时必须整日删除`);
    assert.equal(result.historyRetentionState.detailPoolRevision, beforeRevision + 1,
        '一次容量事务只能递增一次 detailPoolRevision');
    for (const detail of payload.stageDetailsByEvent.service) {
        const state = result.removableEntityStateById[detail.id];
        assert.equal(state.state, 'removed', '容量清理必须把 detail lifecycle 转为 removed');
        assert.equal(state.removalReason, 'detail-pool-capacity', '容量清理必须使用专用 removal reason');
        assert.equal(state.removedAtAssistantCount, 91, '容量清理必须记录当前 assistantCount');
        assert.deepEqual(state, result.removableEntityTombstonesById[detail.id],
            'detail 正文删除必须与 removed state/tombstone 在同一 candidate 闭合');
    }
    const normalized = structuredClone(phase5NextDay);
    normalized.globalEnvelope.payload.scopes.chat.payload = result;
    normalizeTodayTrendV2Candidate(normalized);
}

const phase7WholeDayPayload = phase7CapacityPayload({ detailCount: 90 });
const phase7WholeDayResult = phase7Apply(phase7WholeDayPayload);
assert.equal(phase7WholeDayResult.stageDetailsByEvent.service, undefined,
    '容量治理不得为刚好满足 requiredSlots 而拆分日期组');
assert.equal(phase7WholeDayResult.dynamics.active.find(event => event.id === 'service').latestStage, '容量日摘要',
    '删除 detail 不得改写固定 latestStage');

const phase7UnsafePayload = phase7CapacityPayload({ detailCount: 83, summarizedCount: 2 });
const phase7UnsafeBefore = JSON.stringify(phase7UnsafePayload);
assert.throws(() => phase7Apply(phase7UnsafePayload), error => error?.code === 'TT_DETAIL_CAPACITY_NO_SAFE_GROUP',
    '没有足够已摘要完整日期时必须整单阻塞');
assert.equal(JSON.stringify(phase7UnsafePayload), phase7UnsafeBefore,
    '容量治理失败不得修改调用方 payload');

const phase7OpenDatePayload = phase7CapacityPayload({ detailCount: 83, storyDate: '2025-04-01' });
const phase7OpenDateEvent = phase7OpenDatePayload.dynamics.active.find(event => event.id === 'service');
phase7OpenDateEvent.stages.push({
    id: 'live:service:84', kind: 'live-stage', storyDate: '2025-04-01', time: null, timeLabel: '继续处理中',
    text: '同日期仍处于开放状态', sourceStageStart: 84, sourceStageEnd: 84,
    sourceFloorStart: 93, sourceFloorEnd: 93, revision: 1,
});
phase7OpenDateEvent.latestStage = '同日期仍处于开放状态';
const phase7OpenDateStore = structuredClone(phase5NextDay);
phase7OpenDateStore.globalEnvelope.payload.scopes.chat.payload = phase7OpenDatePayload;
normalizeTodayTrendV2Candidate(phase7OpenDateStore);
const phase7OpenDateBefore = JSON.stringify(phase7OpenDatePayload);
assert.throws(() => phase7Apply(phase7OpenDatePayload),
    error =>error?.code === 'TT_DETAIL_CAPACITY_NO_SAFE_GROUP',
    '同一 storyDate 仍有 live-stage 时，即使存在 closed day-summary 也不得删除该日 detail');
assert.equal(JSON.stringify(phase7OpenDatePayload), phase7OpenDateBefore,
    '开放日期容量阻塞不得修改调用方 payload');

const phase7TwoDayPayload = phase7CapacityPayload({ detailCount: 45, storyDate: '2025-04-01' });
const phase7TwoDayEvent = phase7TwoDayPayload.dynamics.active.find(event => event.id === 'service');
const phase7SecondDayDetails = Array.from({ length: 45 }, (_, index) => ({
    id: `detail:service:${index + 46}`, sourceStageSequence: index + 46,
    text: `次日容量详情${index + 1}`, storyDate: '2025-04-02',
}));
phase7TwoDayPayload.stageDetailsByEvent.service.push(...phase7SecondDayDetails);
phase7TwoDayEvent.stages.push({
    id: 'day:service:2025-04-02', kind: 'day-summary', status: 'closed', storyDate: '2025-04-02',
    timeRange: { start: null, end: null, label: '全天' }, summary: '次日容量日摘要', keyStages: ['service'],
    detailRefs: phase7SecondDayDetails.map(detail => detail.id), detailCount: 45,
    sourceStageStart: 46, sourceStageEnd: 90, sourceFloorStart: 46, sourceFloorEnd: 90, revision: 1,
});
phase7TwoDayEvent.latestStage = '次日容量日摘要';
phase7TwoDayPayload.removableEntityStateById['day:service:2025-04-02'] = {
    entityType: 'day-summary', entityId: 'day:service:2025-04-02', eventId: 'service', state: 'available',
    removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
};
for (const detail of phase7SecondDayDetails) {
    phase7TwoDayPayload.removableEntityStateById[detail.id] = phase7DetailState(detail.id);
}
const phase7TwoDayResult = phase7Apply(phase7TwoDayPayload, 92);
assert.deepEqual(phase7TwoDayResult.stageDetailsByEvent.service.map(detail => detail.storyDate),
    Array.from({ length: 45 }, () => '2025-04-02'), '容量治理必须优先整日删除最早 storyDate，不得跨日拆组');
for (let sequence = 1; sequence <= 45; sequence += 1) {
    assert.equal(phase7TwoDayResult.removableEntityStateById[`detail:service:${sequence}`].state, 'removed',
        '最早日期的全部 detail 必须进入 removed lifecycle');
}
for (let sequence = 46; sequence <= 90; sequence += 1) {
    assert.equal(phase7TwoDayResult.removableEntityStateById[`detail:service:${sequence}`].state, 'available',
        '容量满足后不得继续删除较晚日期 detail');
}

const phase7CanonicalBase = structuredClone(phase5NextDay);
const phase7CanonicalPayload = phase7CapacityPayload({ detailCount: 80, storyDate: '2025-04-01' });
const phase7CanonicalEvent = phase7CanonicalPayload.dynamics.active.find(event => event.id === 'service');
phase7CanonicalEvent.stages.push({
    id: 'live:service:81', kind: 'live-stage', storyDate: '2025-04-02', time: null, timeLabel: '全天',
    text: '等待次日封闭的进展', sourceStageStart: 81, sourceStageEnd: 81,
    sourceFloorStart: 93, sourceFloorEnd: 93, revision: 1,
});
phase7CanonicalEvent.latestStage = '等待次日封闭的进展';
phase7CanonicalBase.globalEnvelope.payload.scopes.chat.payload = phase7CanonicalPayload;
const phase7CanonicalNormalized = normalizeTodayTrendV2Candidate(phase7CanonicalBase);
const phase7CanonicalGenerated = structuredClone(buildReadOnlyShadow(phase7CanonicalNormalized).scopes.chat);
const phase7CanonicalGeneratedEvent = phase7CanonicalGenerated.dynamics.active.find(event => event.id === 'service');
phase7CanonicalGeneratedEvent.stages.push('新日期进展');
phase7CanonicalGeneratedEvent.latestStage = '新日期进展';
const phase7CanonicalResult = applyTodayTrendGenerationToV2(phase7CanonicalNormalized, 'chat', phase7CanonicalGenerated,
    phase5Producer('service', [phase5Stage('新日期进展')], [{
        summaryText: '完成等待事项', keyStages: ['service'],
    }]), { trustedStoryDate: '2025-04-03', assistantCount: 94, generatedAt: 9700 });
const phase7CanonicalResultPayload = phase7CanonicalResult.globalEnvelope.payload.scopes.chat.payload;
assert.equal(phase7CanonicalResultPayload.stageDetailsByEvent.service.length, 1,
    'canonical apply 从 80 条封入新 detail 后必须先整日清理到上限内');
assert.equal(phase7CanonicalResultPayload.stageDetailsByEvent.service[0].id, 'detail:service:81',
    'canonical apply 必须保留较晚已封闭日期的 detail');
assert.equal(phase7CanonicalResultPayload.dynamics.active.find(event => event.id === 'service').stages.at(-1).text,
    '新日期进展', '容量治理不得破坏同事务追加的新日期 live-stage');
assert.equal(phase7CanonicalResultPayload.historyRetentionState.detailPoolRevision,
    phase7CanonicalPayload.historyRetentionState.detailPoolRevision + 1,
    'canonical apply 同事务封日与容量删除只能递增一次 detailPoolRevision');
assert.equal(Object.values(phase7CanonicalResultPayload.removableEntityStateById)
    .filter(state => state.entityType === 'detail' && state.removalReason === 'detail-pool-capacity').length, 80,
'canonical apply 必须在规范化提交结果中保留全部容量删除审计');

const legacyPhase5Store = structuredClone(phase5NextDay);
legacyPhase5Store.globalEnvelope.schemaVersion = 1;
for (const scopeEnvelope of Object.values(legacyPhase5Store.globalEnvelope.payload.scopes)) {
    scopeEnvelope.schemaVersion = 1;
    const migrateFixtureEvent = event => {
        for (const stage of event.stages) {
            if (stage.storyDate === '2025-04-15') stage.storyDate = '2025/4/15';
            if (stage.storyDate === '2025-04-16') stage.storyDate = '2025/4/16';
            if (stage.time === '07:05') stage.time = '7:05';
            if (stage.id === 'day:service:2025-04-15') stage.id = 'day:service:2025/4/15';
        }
    };
    const activeService = scopeEnvelope.payload.dynamics.active.find(event => event.id === 'service');
    activeService.stages.push({
        ...structuredClone(phase4ProjectionFixtures.period),
        startDate: '2025/4/15', startTime: '7:20', endDate: '2025/4/16',
        childSummaryRefs: ['day:service:2025/4/15'],
    });
    activeService.latestStage = phase4ProjectionFixtures.period.summary;
    [...scopeEnvelope.payload.dynamics.active, ...scopeEnvelope.payload.dynamics.archived].forEach(migrateFixtureEvent);
    for (const snapshot of scopeEnvelope.payload.generationSnapshots) {
        [...snapshot.dynamics.active, ...snapshot.dynamics.archived].forEach(migrateFixtureEvent);
    }
    const oldDayState = scopeEnvelope.payload.removableEntityStateById['day:service:2025-04-15'];
    if (oldDayState) {
        delete scopeEnvelope.payload.removableEntityStateById['day:service:2025-04-15'];
        oldDayState.entityId = 'day:service:2025/4/15';
        scopeEnvelope.payload.removableEntityStateById['day:service:2025/4/15'] = oldDayState;
    }
}
const legacyPhase5Envelope = { schemaVersion: 2, revision: 1, payload: legacyPhase5Store };
const migratedLegacyEnvelope = normalizeTodayTrendV2Envelope(legacyPhase5Envelope);
const migratedLegacyPayload = migratedLegacyEnvelope.payload.globalEnvelope.payload.scopes.chat.payload;
assert.equal(migratedLegacyEnvelope.schemaVersion, 3, '旧 v2 envelope 必须升级到当前持久化版本');
assert.equal(migratedLegacyEnvelope.payload.globalEnvelope.schemaVersion, 2, '旧 global envelope 必须严格重写为当前版本');
assert.equal(migratedLegacyPayload.dynamics.active[0].stages.find(stage => stage.kind === 'day-summary').id,
    'day:service:2025-04-15', '旧日期派生的 day-summary ID 必须同步规范化');
assert.equal(migratedLegacyPayload.removableEntityStateById['day:service:2025-04-15'].entityId,
    'day:service:2025-04-15', '旧日期派生的 removable state key 与 entityId 必须同步规范化');
assert.deepEqual(migratedLegacyPayload.dynamics.active[0].stages.find(stage => stage.kind === 'period-summary').childSummaryRefs,
    ['day:service:2025-04-15'], '旧 period summary 引用必须随 day-summary ID 同步规范化');
assert.equal(legacyPhase5Envelope.payload.globalEnvelope.schemaVersion, 1, '旧 envelope 迁移不得原地改写持久化输入');
assert.throws(() => normalizeTodayTrendV2Envelope({ ...legacyPhase5Envelope, unexpected: true }),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', '旧 authority envelope 顶层额外字段必须 fail closed');
assert.throws(() => normalizeTodayTrendV2Envelope({ ...migratedLegacyEnvelope, unexpected: true }),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', '当前 authority envelope 顶层额外字段必须 fail closed');
const invalidLegacyEnvelope = structuredClone(legacyPhase5Envelope);
const invalidLegacyStage = invalidLegacyEnvelope.payload.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages
    .find(stage => stage.kind === 'live-stage');
invalidLegacyStage.storyDate = '2025/2/30';
const invalidLegacyBefore = JSON.stringify(invalidLegacyEnvelope);
assert.throws(() => normalizeTodayTrendV2Envelope(invalidLegacyEnvelope), error =>
    error?.code === 'TT_V2_LEGACY_MIGRATION_FAILED'
    && error.cause?.diagnostics?.[0]?.path?.endsWith('.storyDate'),
'旧 envelope 含非法自然日时必须返回字段路径诊断');
assert.equal(JSON.stringify(invalidLegacyEnvelope), invalidLegacyBefore,
    '旧 envelope 迁移失败不得覆盖原持久化记录');

for (const unsupportedLegacyStoryDate of ['04/05/2025', '15/04/2025', '2025.04.15', '2025-04-15T00:00:00Z', 'April 15, 2025']) {
    const unsupportedLegacyEnvelope = structuredClone(legacyPhase5Envelope);
    const unsupportedLegacyStage = unsupportedLegacyEnvelope.payload.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages
        .find(stage => stage.kind === 'live-stage');
    unsupportedLegacyStage.storyDate = unsupportedLegacyStoryDate;
    const unsupportedLegacyBefore = JSON.stringify(unsupportedLegacyEnvelope);
    assert.throws(() => normalizeTodayTrendV2Envelope(unsupportedLegacyEnvelope), error =>
        error?.code === 'TT_V2_LEGACY_MIGRATION_FAILED'
        && error.cause?.diagnostics?.[0]?.path?.endsWith('.storyDate'),
    `旧 envelope 日期 ${unsupportedLegacyStoryDate} 不得被猜测解析，必须返回字段路径诊断`);
    assert.equal(JSON.stringify(unsupportedLegacyEnvelope), unsupportedLegacyBefore,
        `旧 envelope 日期 ${unsupportedLegacyStoryDate} 迁移失败不得覆盖原持久化记录`);
}

const danglingLegacyEnvelope = structuredClone(legacyPhase5Envelope);
const danglingLegacyPeriod = danglingLegacyEnvelope.payload.globalEnvelope.payload.scopes.chat.payload.dynamics.active[0].stages
    .find(stage => stage.kind === 'period-summary');
danglingLegacyPeriod.childSummaryRefs = ['day:service:missing'];
assert.throws(() => normalizeTodayTrendV2Envelope(danglingLegacyEnvelope), error =>
    error?.code === 'TT_V2_LEGACY_MIGRATION_FAILED'
    && error.cause?.diagnostics?.[0]?.path?.endsWith('.childSummaryRefs.0'),
'旧 envelope 悬空引用必须返回精确字段路径，不能降级为无路径的严格校验错误');

const failedLegacyLoadHarness = createAuthorityHarness();
failedLegacyLoadHarness.records.set(TODAY_TREND_V2_AUTHORITY_KEY, normalizeTodayTrendV2Authority({
    schemaVersion: 1, epoch: 1, authorityRevision: 1, storeRevision: 1, scopeRevisionByStorageId: { chat: 1 },
    ownerTabId: null, readV2: true, writeV2: false, serveV2: false,
}));
failedLegacyLoadHarness.records.set(TODAY_TREND_V2_STORAGE_KEY, invalidLegacyEnvelope);
const failedLegacyLoadBefore = JSON.stringify([...failedLegacyLoadHarness.records.entries()]);
let failedLegacyLoadCasCalls = 0;
const failedLegacyLoadAuthority = createTodayTrendV2Authority({
    readEntry: failedLegacyLoadHarness.readEntry,
    compareAndSwap: async request => { failedLegacyLoadCasCalls += 1; return failedLegacyLoadHarness.compareAndSwap(request); },
    storage: memoryStorage(), tabId: 'legacy-failed-reader', BroadcastChannelImpl: undefined,
});
await assert.rejects(() => failedLegacyLoadAuthority.load(), error => error?.code === 'TT_V2_LEGACY_MIGRATION_FAILED',
    'authority 读取不可迁移旧记录时必须原样透传可恢复诊断');
assert.equal(failedLegacyLoadCasCalls, 0, 'authority 读取迁移失败不得触发任何 CAS 写入');
assert.equal(JSON.stringify([...failedLegacyLoadHarness.records.entries()]), failedLegacyLoadBefore,
    'authority 读取迁移失败不得覆盖 primary 或 authority 持久化记录');
failedLegacyLoadAuthority.close();

const phase8CoreEvent = structuredClone(phase4AvailablePayload.dynamics.active[0]);
phase8CoreEvent.lifecycle = 'archived';
phase8CoreEvent.archivedAtAssistantCount = 12;
phase8CoreEvent.archivedSequence = 7;
const phase8Core = extractArchivedFixedCore(phase8CoreEvent);
assert.equal(Object.hasOwn(phase8Core, 'lifecycle'), false, 'fixed core 不得包含 event lifecycle');
assert.equal(Object.hasOwn(phase8Core.stages[0], 'detailRefs'), false, 'fixed core stage 必须排除 detail refs');
assert.deepEqual(Object.keys(phase8Core).sort(), [
    'archivedAtAssistantCount', 'archivedSequence', 'createdAt', 'finalResult', 'id', 'latestStage', 'origin',
    'outcome', 'participants', 'relatedEventIds', 'stageLabel', 'stages', 'title', 'type', 'updatedAt',
].sort(), 'fixed core event 必须是显式 closed-set 投影');
const phase8PeriodCore = extractArchivedFixedCore({ ...phase8CoreEvent, stages: [{ ...phase4ProjectionFixtures.period,
    childSummaryRefs: ['day:service:2025-04-15'] }] });
assert.equal(Object.hasOwn(phase8PeriodCore.stages[0], 'childSummaryRefs'), false, 'fixed core period 必须排除 child refs');
assert.equal(phase8PeriodCore.stages[0].historicalDetailCount, phase4ProjectionFixtures.period.historicalDetailCount,
    'fixed core period 必须保留历史 count');

const phase8Payload = structuredClone(migratedValidV2.globalEnvelope.payload.scopes.chat.payload);
const phase8Archived = sequence => ({ id: `phase8-${sequence}`, archivedSequence: sequence,
    archivedAtAssistantCount: sequence === 1 ? 12 : 32 });
phase8Payload.dynamics.archived = [phase8Archived(1), phase8Archived(2), phase8Archived(3)];
phase8Payload.historyRetentionSettings = { archivedDetailLatestEventCount: 2, archivedDetailRetentionFloors: 20, revision: 1 };
phase8Payload.historyRetentionState.highWaterAssistantCount = 32;
let phase8Decisions = evaluateTodayTrendArchivedRetention(phase8Payload);
assert.deepEqual(phase8Decisions.map(item => [item.eventId, item.rankProtected, item.floorProtected, item.protected]), [
    ['phase8-3', true, true, true], ['phase8-2', true, true, true], ['phase8-1', false, true, true],
], 'N/L 默认值必须按 archivedSequence DESC 与 OR 语义保护');
phase8Payload.historyRetentionSettings.archivedDetailLatestEventCount = 0;
phase8Payload.historyRetentionSettings.archivedDetailRetentionFloors = 0;
assert.ok(evaluateTodayTrendArchivedRetention(phase8Payload).every(item => item.deletable), 'N=0/L=0 必须全部失去保护');
phase8Payload.historyRetentionSettings.archivedDetailLatestEventCount = 1;
assert.deepEqual(evaluateTodayTrendArchivedRetention(phase8Payload).map(item => item.protected), [true, false, false], 'N>0/L=0 只能排名保护');
phase8Payload.historyRetentionSettings.archivedDetailLatestEventCount = 0;
phase8Payload.historyRetentionSettings.archivedDetailRetentionFloors = 20;
assert.deepEqual(evaluateTodayTrendArchivedRetention(phase8Payload).map(item => item.floorProtected), [true, true, true], 'N=0/L>0 只能楼层保护');
phase8Payload.historyRetentionState.highWaterAssistantCount = 33;
assert.equal(evaluateTodayTrendArchivedRetention(phase8Payload).find(item => item.eventId === 'phase8-1').floorProtected, false,
    '#12 归档在高水位 #33 时必须超过 L=20');
phase8Payload.historyRetentionState.highWaterAssistantCount = null;
assert.ok(evaluateTodayTrendArchivedRetention(phase8Payload).every(item => item.floorProtected), 'L>0 且高水位 unknown 必须保守保护');
phase8Payload.historyRetentionSettings.archivedDetailRetentionFloors = 0;
assert.ok(evaluateTodayTrendArchivedRetention(phase8Payload).every(item => !item.floorProtected), 'L=0 必须覆盖 unknown 分支');
phase8Payload.dynamics.archived = [phase8Archived(2), { ...phase8Archived(2), id: 'phase8-a' }];
assert.deepEqual(evaluateTodayTrendArchivedRetention(phase8Payload).map(item => item.eventId), ['phase8-2', 'phase8-a'],
    '同 sequence 必须按 eventId ASC 确定性排名');

const phase8SettingsBefore = JSON.stringify(migratedValidV2.globalEnvelope.payload.scopes.chat.payload.archivedRemovableDataByEvent);
const phase8SettingsEnvelope = migratedValidV2.globalEnvelope.payload.scopes.chat;
const phase8Saved = saveTodayTrendRetentionSettingsToV2(migratedValidV2, 'chat', {
    archivedDetailLatestEventCount: ' 0 ', archivedDetailRetentionFloors: '1000',
}, {
    expectedScopeRevision: phase8SettingsEnvelope.revision, expectedSettingsRevision: phase8SettingsEnvelope.payload.historyRetentionSettings.revision,
});
assert.deepEqual(phase8Saved.globalEnvelope.payload.scopes.chat.payload.historyRetentionSettings,
    { archivedDetailLatestEventCount: 0, archivedDetailRetentionFloors: 1000, revision: 2 }, '设置保存必须严格解析并单调推进 revision');
assert.equal(phase8Saved.globalEnvelope.payload.scopes.chat.payload.historyRetentionState.retentionPolicyRevision, 2,
    '设置保存必须推进 retentionPolicyRevision');
assert.equal(JSON.stringify(phase8Saved.globalEnvelope.payload.scopes.chat.payload.archivedRemovableDataByEvent), phase8SettingsBefore,
    '设置保存不得立即清理正文');
for (const value of ['', '1.5', '1e2', 'NaN', '81']) assert.throws(() => saveTodayTrendRetentionSettingsToV2(migratedValidV2, 'chat', {
    archivedDetailLatestEventCount: value, archivedDetailRetentionFloors: '20',
}, {
    expectedScopeRevision: phase8SettingsEnvelope.revision, expectedSettingsRevision: phase8SettingsEnvelope.payload.historyRetentionSettings.revision,
}), error => error?.code === 'TT_RETENTION_SETTINGS_INVALID', `设置 N 必须拒绝 ${value}`);
assert.throws(() => saveTodayTrendRetentionSettingsToV2(migratedValidV2, 'chat', {
    archivedDetailLatestEventCount: '2', archivedDetailRetentionFloors: '20',
}, {
    expectedScopeRevision: phase8SettingsEnvelope.revision + 1,
    expectedSettingsRevision: phase8SettingsEnvelope.payload.historyRetentionSettings.revision,
}), error => error?.code === 'TT_SETTINGS_REVISION_CONFLICT', '迟到设置保存必须以明确冲突码拒绝');

const phase8ArchiveBase = normalizeTodayTrendV2Candidate(phase4Available);
const phase8GeneratedArchive = buildReadOnlyShadow(phase8ArchiveBase).scopes.chat;
const phase8Service = phase8GeneratedArchive.dynamics.active.find(event => event.id === phase4EventId);
phase8GeneratedArchive.dynamics.active = phase8GeneratedArchive.dynamics.active.filter(event => event.id !== phase4EventId);
phase8GeneratedArchive.dynamics.archived.push({ ...phase8Service, lifecycle: 'archived', outcome: 'resolved', finalResult: '完成', updatedAt: phase8Service.updatedAt + 1 });
const phase8ArchivedStore = applyTodayTrendGenerationToV2(phase8ArchiveBase, 'chat', phase8GeneratedArchive, { events: [] }, {
    assistantCount: 12, generatedAt: 12, snapshot: false,
});
const phase8ArchivedPayload = phase8ArchivedStore.globalEnvelope.payload.scopes.chat.payload;
const phase8ArchivedService = phase8ArchivedPayload.dynamics.archived.find(event => event.id === phase4EventId);
assert.equal(phase8ArchivedService.archivedSequence, phase8ArchiveBase.globalEnvelope.payload.scopes.chat.payload.historyRetentionState.nextArchivedSequence,
    'active->archived 必须从事务开始时 nextArchivedSequence 分配 sequence');
assert.equal(phase8ArchivedService.archivedAtAssistantCount, 12, '归档必须记录事务开始时可靠 assistant 高水位');
assert.equal(phase8ArchivedPayload.historyRetentionState.highWaterAssistantCount, 12, '成功 canonical generation 必须推进高水位');
assert.ok(phase8ArchivedPayload.archivedRemovableDataByEvent[phase4EventId], 'canonical apply 必须迁移归档 removable 容器');
assert.ok(phase8ArchivedPayload.stageDetailsByEvent[phase4EventId], 'canonical apply 必须保留归档 detail 正文');
const phase8NoLower = applyTodayTrendGenerationToV2(phase8ArchivedStore, 'chat', buildReadOnlyShadow(phase8ArchivedStore).scopes.chat,
    { events: [] }, { assistantCount: 5, generatedAt: 13, snapshot: false });
assert.equal(phase8NoLower.globalEnvelope.payload.scopes.chat.payload.historyRetentionState.highWaterAssistantCount, 12,
    '较小成功楼层不得降低高水位');
const phase8CleanupSettings = saveTodayTrendRetentionSettingsToV2(phase8ArchivedStore, 'chat', {
    archivedDetailLatestEventCount: '0', archivedDetailRetentionFloors: '0',
}, {
    expectedScopeRevision: phase8ArchivedStore.globalEnvelope.payload.scopes.chat.revision, expectedSettingsRevision: 1,
});
const phase8BeforeCleanupCore = extractArchivedFixedCore(phase8CleanupSettings.globalEnvelope.payload.scopes.chat.payload.dynamics.archived
    .find(event => event.id === phase4EventId));
const phase8Cleaned = applyTodayTrendGenerationToV2(phase8CleanupSettings, 'chat', buildReadOnlyShadow(phase8CleanupSettings).scopes.chat,
    { events: [] }, { assistantCount: 33, generatedAt: 33, snapshot: false });
const phase8CleanedPayload = phase8Cleaned.globalEnvelope.payload.scopes.chat.payload;
assert.deepEqual(extractArchivedFixedCore(phase8CleanedPayload.dynamics.archived.find(event => event.id === phase4EventId)), phase8BeforeCleanupCore,
    'archived retention 清理前后 fixed core 必须 sameJson');
assert.equal(phase8CleanedPayload.stageDetailsByEvent[phase4EventId], undefined, 'archived retention 必须删除归档 detail 正文');
const phase8RemovedStates = Object.values(phase8CleanedPayload.removableEntityStateById)
    .filter(item => item.eventId === phase4EventId);
assert.equal(phase8RemovedStates.length, 2, '归档清理必须覆盖 detail 与 day-summary，禁止空断言');
for (const state of phase8RemovedStates) {
    assert.equal(state.state, 'removed', '归档清理必须写 removed state');
    assert.equal(state.removalReason, 'archived-retention', '归档清理必须使用 archived-retention 原因');
    assert.deepEqual(phase8CleanedPayload.removableEntityTombstonesById[state.entityId], state,
        '归档清理必须为每个 removed state 写一致 tombstone');
}
assert.equal(phase8CleanedPayload.dynamics.active.some(event => event.id === phase4EventId), false, '归档治理不得产生 active detail 串线');

assert.throws(() => rollbackTodayTrendV2Scope(phase8Cleaned, 'chat', 0),
    error => error?.code === 'TT_CANONICAL_CHECKPOINT_INCOMPLETE',
    '旧 v2 projection-only snapshot 不得伪造完整历史，rollback 必须可诊断 fail-closed');

const phase9BeforeF = applyTodayTrendGenerationToV2(
    normalizedPhase4Available, 'chat', buildReadOnlyShadow(normalizedPhase4Available).scopes.chat,
    { events: [] }, { assistantCount: 46, generatedAt: 46 },
);
const phase9FSettings = saveTodayTrendRetentionSettingsToV2(phase9BeforeF, 'chat', {
    archivedDetailLatestEventCount: '0', archivedDetailRetentionFloors: '0',
}, {
    expectedScopeRevision: phase9BeforeF.globalEnvelope.payload.scopes.chat.revision, expectedSettingsRevision: 1,
});
const phase9FFacade = buildReadOnlyShadow(phase9FSettings).scopes.chat;
const phase9FEvent = phase9FFacade.dynamics.active.find(event => event.id === 'service');
phase9FFacade.dynamics.active = phase9FFacade.dynamics.active.filter(event => event.id !== 'service');
phase9FFacade.dynamics.archived.push({
    ...phase9FEvent, lifecycle: 'archived', outcome: 'resolved', finalResult: 'F 楼层归档', updatedAt: phase9FEvent.updatedAt + 1,
});
const phase9AtF = applyTodayTrendGenerationToV2(
    phase9FSettings, 'chat', phase9FFacade, { events: [] }, { assistantCount: 47, generatedAt: 47 },
);
const phase9AtFPayload = phase9AtF.globalEnvelope.payload.scopes.chat.payload;
assert.equal(phase9AtFPayload.dynamics.archived.some(event => event.id === 'service'), true, '#F 必须新增 archived event');
assert.equal(Object.values(phase9AtFPayload.removableEntityTombstonesById).some(state => state.eventId === 'service'), true,
    '#F retention 必须新增 tombstone');
const phase9RestoredFMinus1 = rollbackTodayTrendV2Scope(phase9AtF, 'chat', 46);
const phase9RestoredPayload = phase9RestoredFMinus1.globalEnvelope.payload.scopes.chat.payload;
assert.equal(phase9RestoredPayload.dynamics.active.some(event => event.id === 'service'), true,
    '回滚 F-1 必须恢复当时 active event');
assert.equal(phase9RestoredPayload.dynamics.archived.some(event => event.id === 'service'), false,
    '回滚 F-1 必须消除 #F 新增 archived event，不得保留当前 archived');
const phase9UnorderedSnapshots = structuredClone(phase9AtF);
phase9UnorderedSnapshots.globalEnvelope.payload.scopes.chat.payload.generationSnapshots.reverse();
const phase9NormalizedSnapshots = normalizeTodayTrendV2Store(phase9UnorderedSnapshots)
    .globalEnvelope.payload.scopes.chat.payload.generationSnapshots;
assert.deepEqual(phase9NormalizedSnapshots.map(snapshot => snapshot.assistantCount), [0, 7, 46, 47],
    'canonical normalizer 必须按 assistantCount 规范化 snapshot 顺序');
assert.equal(rollbackTodayTrendV2Scope(phase9UnorderedSnapshots, 'chat', 46)
    .globalEnvelope.payload.scopes.chat.payload.dynamics.active.some(event => event.id === 'service'), true,
'乱序持久化 snapshot 的 rollback 仍必须选择目标 floor 最近 checkpoint');
const phase9DuplicateSnapshot = structuredClone(phase9AtF);
phase9DuplicateSnapshot.globalEnvelope.payload.scopes.chat.payload.generationSnapshots.push(
    structuredClone(phase9DuplicateSnapshot.globalEnvelope.payload.scopes.chat.payload.generationSnapshots.at(-1)));
assert.throws(() => normalizeTodayTrendV2Store(phase9DuplicateSnapshot), error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'canonical snapshot 不得接受重复 assistantCount');
const phase9MissingRollbackCheckpoint = structuredClone(phase9AtF);
phase9MissingRollbackCheckpoint.globalEnvelope.payload.scopes.chat.payload.generationSnapshots = [];
assert.throws(() => rollbackTodayTrendV2Scope(phase9MissingRollbackCheckpoint, 'chat', 46),
    error => error?.code === 'TT_ROLLBACK_CHECKPOINT_MISSING',
    '聊天删除早于 retained checkpoint 窗口时必须 fail-closed，禁止静默保留较新 canonical 状态');
const phase9SelfCertifiedRewrite = structuredClone(phase9AtF);
const phase9SelfCertifiedPayload = phase9SelfCertifiedRewrite.globalEnvelope.payload.scopes.chat.payload;
const phase9SelfCertifiedArchived = phase9SelfCertifiedPayload.dynamics.archived.find(event => event.id === 'service');
phase9SelfCertifiedArchived.title = '伪造 checkpoint 的归档标题';
phase9SelfCertifiedPayload.fixedCoreBaselineByEvent.service = extractArchivedFixedCore(phase9SelfCertifiedArchived);
phase9SelfCertifiedRewrite.globalEnvelope.payload.scopes.chat.payload = appendTodayTrendCanonicalSnapshot(
    phase9SelfCertifiedPayload, 48, 48, phase9SelfCertifiedRewrite.globalEnvelope.revision + 1,
);
assert.throws(() => validateTodayTrendV2Transition(phase9AtF, phase9SelfCertifiedRewrite),
    error => error?.code === 'TT_V2_SCHEMA_INVALID',
    'candidate 不得通过追加描述自身的 full checkpoint 绕过 archived fixed-core 不可变门禁');
const phase9RegeneratedFacade = buildReadOnlyShadow(phase9BeforeF).scopes.chat;
phase9RegeneratedFacade.world.items[0].summary = 'F 楼层重新生成结果';
const phase9RerolledF = applyTodayTrendRerollToV2(phase9AtF, 'chat', 46, phase9RegeneratedFacade,
    { events: [] }, { assistantCount: 47, generatedAt: 470 });
const phase9RerolledPayload = phase9RerolledF.globalEnvelope.payload.scopes.chat.payload;
assert.equal(phase9RerolledPayload.world.items[0].summary, 'F 楼层重新生成结果',
    'reroll 必须从 F-1 完整恢复后提交新的 F 结果');
assert.equal(phase9RerolledPayload.dynamics.archived.some(event => event.id === 'service'), false,
    'reroll 不得保留旧 F 引入的 archived event');
assert.equal(Object.values(phase9RerolledPayload.removableEntityTombstonesById).some(state => state.eventId === 'service'), false,
    'reroll 不得保留旧 F 引入的 tombstone');
assert.equal(phase9RerolledPayload.generationSnapshots.at(-1).rerollFromAssistantCount, 46,
    '新的 F checkpoint 必须记录实际采用的前置 reroll checkpoint');
assert.throws(() => applyTodayTrendRerollToV2(phase9AtF, 'chat', 47, phase9RegeneratedFacade,
    { events: [] }, { assistantCount: 47, generatedAt: 471 }), error => error?.code === 'TT_REROLL_CHECKPOINT_INVALID',
    'reroll 不得把当前 F 或更晚 checkpoint 当作自身基线');

let phase9SchedulerRerollStore = structuredClone(phase9AtF);
phase9SchedulerRerollStore.globalEnvelope.payload.scopes.chat.payload.operation = {
    ...phase9SchedulerRerollStore.globalEnvelope.payload.scopes.chat.payload.operation,
    lastSuccessfulAssistantCount: 47, lastSuccessfulRunAt: 47,
};
phase9SchedulerRerollStore = normalizeTodayTrendV2Store(phase9SchedulerRerollStore);
let phase9SchedulerRerollCalls = 0;
const phase9SchedulerReroll = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => {
        phase9SchedulerRerollCalls += 1;
        assert.equal(scope.dynamics.archived.some(event => event.id === 'service'), false,
            '已同步 F 的手动更新必须以 F-1 完整 checkpoint 的 projection 生成');
        const regenerated = structuredClone(scope);
        regenerated.world.items[0].summary = 'scheduler F 楼层重新生成结果';
        return { scope: regenerated, history: { events: [] } };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        loadCanonical: async () => structuredClone(phase9SchedulerRerollStore),
        commitStore: async (mutate, _task, options) => {
            assert.deepEqual(options, { canonical: true, scopeId: 'chat',
                expectedStoreRevision: phase9SchedulerRerollStore.globalEnvelope.revision,
                expectedScopeRevision: phase9SchedulerRerollStore.globalEnvelope.payload.scopes.chat.revision,
            }, 'reroll 必须冻结 canonical store/scope revision 并通过单事务提交');
            phase9SchedulerRerollStore = await mutate(structuredClone(phase9SchedulerRerollStore));
            return buildReadOnlyShadow(phase9SchedulerRerollStore);
        },
    },
    getStore: async () => buildReadOnlyShadow(phase9SchedulerRerollStore),
    getStorageId: () => 'chat', getChat: () => Array.from({ length: 48 }, () => ({ mes: 'F' })), getFloor: () => 47,
});
await phase9SchedulerReroll.manual({ floor: 47 });
assert.equal(phase9SchedulerRerollCalls, 1, '已同步 F 的手动 reroll 必须只调用一次 AI');
assert.equal(phase9SchedulerRerollStore.globalEnvelope.payload.scopes.chat.payload.world.items[0].summary,
    'scheduler F 楼层重新生成结果', 'scheduler reroll 必须提交新的 F 结果');
assert.equal(phase9SchedulerRerollStore.globalEnvelope.payload.scopes.chat.payload.generationSnapshots.at(-1).rerollFromAssistantCount,
    46, 'scheduler reroll 必须持久化实际 F-1 checkpoint');
let phase9MissingCheckpointStore = structuredClone(migratedValidV2);
const phase9StaleRerollBase = structuredClone(phase9SchedulerRerollStore);
const phase9StaleRerollRevision = phase9StaleRerollBase.globalEnvelope.revision;
const phase9StaleRerollScopeRevision = phase9StaleRerollBase.globalEnvelope.payload.scopes.chat.revision;
const phase9StaleRerollCurrent = structuredClone(phase9StaleRerollBase);
phase9StaleRerollCurrent.globalEnvelope.revision += 1;
phase9StaleRerollCurrent.globalEnvelope.payload.scopes.chat.revision += 1;
let phase9StaleRerollWrites = 0;
const phase9StaleRerollCommitter = createTodayTrendCommitter({
    loadCanonical: async () => structuredClone(phase9StaleRerollCurrent),
    save: async () => { phase9StaleRerollWrites += 1; throw new Error('stale reroll 不得写入'); },
});
await assert.rejects(() => phase9StaleRerollCommitter.commitStore(store => store, null, {
    canonical: true, scopeId: 'chat', expectedStoreRevision: phase9StaleRerollRevision,
    expectedScopeRevision: phase9StaleRerollScopeRevision, refreshInjection: false,
}), error => error?.code === 'TT_REROLL_STALE_SCOPE',
'AI 期间 canonical revision 变化时，reroll 必须在 candidate/journal 写入前 fail-closed');
assert.equal(phase9StaleRerollWrites, 0, 'reroll stale revision 必须保持零持久化写入');
phase9MissingCheckpointStore.globalEnvelope.payload.scopes.chat.payload.operation = {
    ...phase9MissingCheckpointStore.globalEnvelope.payload.scopes.chat.payload.operation,
    lastSuccessfulAssistantCount: 47, lastSuccessfulRunAt: 47,
};
phase9MissingCheckpointStore.globalEnvelope.payload.scopes.chat.payload.generationSnapshots = phase9MissingCheckpointStore
    .globalEnvelope.payload.scopes.chat.payload.generationSnapshots.map(snapshot => ({
        ...structuredClone(snapshot), restoreCapability: 'projection-only', checkpointRef: null, rerollFromAssistantCount: null,
    }));
normalizeTodayTrendV2Store(phase9MissingCheckpointStore);
let phase9MissingCheckpointCalls = 0;
let phase9MissingCheckpointCommitted = false;
const phase9MissingCheckpointScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => {
        phase9MissingCheckpointCalls += 1;
        const refreshed = structuredClone(scope);
        refreshed.world.items[0].summary = '无旧 checkpoint 时仍可刷新当前楼层';
        return { scope: refreshed, history: { events: [] } };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        loadCanonical: async () => structuredClone(phase9MissingCheckpointStore),
        commitStore: async (mutate, _task, options) => {
            assert.deepEqual(options, { canonical: true, scopeId: 'chat' },
                '无旧 checkpoint 的同楼层刷新不得伪造 reroll revision fence，但仍必须走 canonical commit');
            phase9MissingCheckpointCommitted = true;
            phase9MissingCheckpointStore = await mutate(structuredClone(phase9MissingCheckpointStore));
            return buildReadOnlyShadow(phase9MissingCheckpointStore);
        },
    },
    getStore: async () => buildReadOnlyShadow(phase9MissingCheckpointStore),
    getStorageId: () => 'chat', getFloor: () => 47,
});
await phase9MissingCheckpointScheduler.manual({ floor: 47 });
assert.equal(phase9MissingCheckpointCalls, 1, '无旧 checkpoint 的同楼层刷新仍必须只调用一次 AI');
assert.equal(phase9MissingCheckpointCommitted, true, '无旧 checkpoint 的同楼层刷新必须提交 canonical candidate');
assert.equal(phase9MissingCheckpointStore.globalEnvelope.payload.scopes.chat.payload.world.items[0].summary,
    '无旧 checkpoint 时仍可刷新当前楼层', '无旧 checkpoint 的手动更新必须以当前 canonical scope 刷新');
assert.equal(phase9MissingCheckpointStore.globalEnvelope.payload.scopes.chat.payload.generationSnapshots.at(-1).assistantCount,
    47, '同楼层刷新必须重新写入当前楼层 snapshot');
assert.equal(phase9MissingCheckpointStore.globalEnvelope.payload.scopes.chat.payload.generationSnapshots.at(-1).rerollFromAssistantCount,
    null, '同楼层刷新不得伪造 reroll 基线');

const phase9RerollSagaInitial = structuredClone(phase9AtF);
phase9RerollSagaInitial.globalEnvelope.payload.scopes.chat.payload.operation = {
    ...phase9RerollSagaInitial.globalEnvelope.payload.scopes.chat.payload.operation,
    lastSuccessfulAssistantCount: 47, lastSuccessfulRunAt: 47,
};
const phase9RerollSagaHarness = createAuthorityHarness();
const phase9RerollSagaAuthority = createTodayTrendV2Authority({
    ...phase9RerollSagaHarness, tabId: 'phase-9-reroll-saga-owner', BroadcastChannelImpl: undefined,
});
await phase9RerollSagaAuthority.acquire({ readV2: true, writeV2: true, initialStore: phase9RerollSagaInitial });
let phase9RerollSagaNow = 9500;
const phase9RerollSagaJournal = createTodayTrendJournal({
    listKeys: async () => [...phase9RerollSagaHarness.records.keys()], readEntry: phase9RerollSagaHarness.readEntry,
    writeEntry: async (key, value) => { phase9RerollSagaHarness.records.set(key, structuredClone(value)); return true; },
    deleteEntry: async key => phase9RerollSagaHarness.records.delete(key), now: () => ++phase9RerollSagaNow,
    transactionId: () => `phase-9-reroll-saga-${phase9RerollSagaNow}`,
});
const phase9RerollSagaStorage = createTodayTrendStorage({
    v2Authority: phase9RerollSagaAuthority, journal: phase9RerollSagaJournal, storage: memoryStorage(),
});
const phase9RerollSagaBefore = await phase9RerollSagaStorage.loadCanonical();
let phase9RerollSagaRefreshes = 0, phase9RerollSagaAiCalls = 0;
const phase9RerollSagaCommitter = createTodayTrendCommitter({
    runtime: {}, load: phase9RerollSagaStorage.load, loadCanonical: phase9RerollSagaStorage.loadCanonical,
    save: phase9RerollSagaStorage.save, storageStatus: phase9RerollSagaStorage.status, journal: phase9RerollSagaJournal,
    refreshInjection: async () => {
        phase9RerollSagaRefreshes += 1;
        return phase9RerollSagaRefreshes === 1 ? { failedWrites: 1, failedKeys: [] } : { failedWrites: 0, failedKeys: [] };
    },
});
const phase9RerollSagaScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => {
        phase9RerollSagaAiCalls += 1;
        const regenerated = structuredClone(scope);
        regenerated.world.items[0].summary = '补偿前的 reroll candidate';
        return { scope: regenerated, history: { events: [] } };
    } },
    committer: phase9RerollSagaCommitter, getStore: phase9RerollSagaStorage.load,
    getStorageId: () => 'chat', getFloor: () => 47,
});
await assert.rejects(() => phase9RerollSagaScheduler.manual({ floor: 47 }), /注入刷新失败/,
    'reroll candidate 注入失败必须触发 canonical saga 补偿');
assert.equal(phase9RerollSagaAiCalls, 1, '补偿路径不得重试或重复调用 reroll AI');
assert.equal(phase9RerollSagaRefreshes, 2, 'reroll 注入失败后必须仅注入一次 previous 补偿状态');
const phase9RerollSagaRestored = await phase9RerollSagaStorage.loadCanonical();
assert.equal(todayTrendStoreDigest(phase9RerollSagaRestored), todayTrendStoreDigest(phase9RerollSagaBefore),
    'reroll 注入补偿必须恢复 reroll 前完整 canonical 业务状态');
assert.equal(phase9RerollSagaRestored.globalEnvelope.payload.scopes.chat.payload.dynamics.archived.some(event => event.id === 'service'), true,
    'reroll 注入补偿必须恢复旧 F archived event');
assert.equal(Object.values(phase9RerollSagaRestored.globalEnvelope.payload.scopes.chat.payload.removableEntityTombstonesById)
    .some(state => state.eventId === 'service'), true, 'reroll 注入补偿必须恢复旧 F tombstone');
assert.equal(await phase9RerollSagaAuthority.release({ readV2: true, serveV2: false }), true,
    'reroll saga 验证完成后必须释放 authority owner');
phase9RerollSagaAuthority.close();

const phase9RemovedCheckpointCandidate = structuredClone(phase8Cleaned);
phase9RemovedCheckpointCandidate.globalEnvelope.payload.scopes.chat.payload = appendTodayTrendCanonicalSnapshot(
    phase9RemovedCheckpointCandidate.globalEnvelope.payload.scopes.chat.payload, 34, 34,
    phase9RemovedCheckpointCandidate.globalEnvelope.revision + 1,
);
const phase9RemovedCheckpoint = normalizeTodayTrendV2Store(phase9RemovedCheckpointCandidate);
const phase9RemovedRestored = rollbackTodayTrendV2Scope(phase9RemovedCheckpoint, 'chat', 34)
    .globalEnvelope.payload.scopes.chat.payload;
for (const state of phase8RemovedStates) assert.equal(phase9RemovedRestored.removableEntityStateById[state.entityId]?.state, 'removed',
    'F-1 checkpoint 中已删除的 removable entity 回滚后不得复活');

const phase9ActiveSnapshotStore = applyTodayTrendGenerationToV2(
    normalizedPhase4Available, 'chat', buildReadOnlyShadow(normalizedPhase4Available).scopes.chat,
    { events: [] }, { assistantCount: 46, generatedAt: 46 },
);
const phase9ActiveSnapshotPayload = phase9ActiveSnapshotStore.globalEnvelope.payload.scopes.chat.payload;
const phase9ActiveManifestEntry = phase9ActiveSnapshotPayload.generationSnapshots.at(-1).detailManifestRefs
    .find(entry => entry.eventId === 'service');
assert.ok(phase9ActiveManifestEntry?.detailRefs.includes('detail:service:4'),
    'active event snapshot 必须为已封日且 available 的 detail 建立 manifest 引用');
assert.deepEqual(phase9ActiveSnapshotPayload.archivedRemovableDataByEvent.service.daySummariesById, {},
    'active event 的 manifest 容器不得复制 day-summary 正文');
assert.equal(resolveTodayTrendV2DetailForTarget(
    phase9ActiveSnapshotStore, 'chat', 'service', 'detail:service:4', 46,
)?.text, '完成阶段详情',
'active event detail 必须在正文、summary source floor、manifest 可见性与 available lifecycle 全部满足时可读');
let phase9BoundedManifestStore = phase9ActiveSnapshotStore;
for (let assistantCount = 47; assistantCount <= 70; assistantCount += 1) {
    phase9BoundedManifestStore = applyTodayTrendGenerationToV2(
        phase9BoundedManifestStore, 'chat', buildReadOnlyShadow(phase9BoundedManifestStore).scopes.chat,
        { events: [] }, { assistantCount, generatedAt: assistantCount },
    );
}
const phase9BoundedManifestPayload = phase9BoundedManifestStore.globalEnvelope.payload.scopes.chat.payload;
assert.equal(phase9BoundedManifestPayload.generationSnapshots.length, 12,
    '长期 active event 的 canonical snapshot 必须保持最多 12 个');
assert.ok(phase9BoundedManifestPayload.generationSnapshots.every(snapshot =>
    snapshot.restoreCapability !== 'full' || (snapshot.checkpointRef?.rootEntityId && snapshot.checkpointRef?.payloadDigest)),
    '每个 full checkpoint 必须只保存可校验 restore manifest/ref');
assert.ok(phase9BoundedManifestPayload.generationSnapshots.every(snapshot => !Object.hasOwn(snapshot, 'checkpoint')),
    '12 个 checkpoint 不得重复内嵌完整 payload');
const phase9CheckpointRoots = new Set(phase9BoundedManifestPayload.generationSnapshots
    .filter(snapshot => snapshot.restoreCapability === 'full').map(snapshot => snapshot.checkpointRef.rootEntityId));
assert.ok(phase9CheckpointRoots.size > 1, '不同 checkpoint 必须保留各自不可变 root entity');
assert.ok(Object.keys(phase9BoundedManifestPayload.checkpointEntityStore).length < 200,
    '相邻 checkpoint 的相同正文/detail/manifest/state 必须按内容实体复用，不能按 12 份完整 payload 复制');
assert.equal(Object.keys(phase9BoundedManifestPayload.archivedRemovableDataByEvent.service.manifestsById).length, 1,
    '长期 active event 必须复用稳定 manifest 正文，禁止随 generation 无界增长');
assert.equal(Object.values(phase9BoundedManifestPayload.removableEntityStateById)
    .filter(state => state.eventId === 'service' && state.entityType === 'manifest').length, 1,
    '长期 active event 的 manifest lifecycle state 必须有界且与正文一一对应');
const phase9ActiveRolledBack = rollbackTodayTrendV2Scope(phase9BoundedManifestStore, 'chat', 60);
const phase9ActiveRolledBackPayload = phase9ActiveRolledBack.globalEnvelope.payload.scopes.chat.payload;
assert.equal(Object.keys(phase9ActiveRolledBackPayload.archivedRemovableDataByEvent.service.manifestsById).length, 1,
    'active rollback 必须保留仍被 checkpoint 使用的稳定 manifest');
assert.equal(phase9ActiveRolledBackPayload.stageDetailsByEvent.service?.[0]?.id, 'detail:service:4',
    'active rollback 必须保留目标 checkpoint 的 detail 正文');
assert.equal(phase9ActiveRolledBackPayload.dynamics.active.find(event => event.id === 'service')
    ?.stages.some(stage => stage.kind === 'day-summary' && stage.detailRefs.includes('detail:service:4')), true,
    'active rollback 必须保留 detail 的 day-summary source floor');
assert.equal(phase9ActiveRolledBackPayload.generationSnapshots.some(snapshot =>
    snapshot.visibleFromAssistantCount <= 60 && snapshot.detailManifestRefs.some(entry =>
        entry.eventId === 'service' && entry.visibleFromAssistantCount <= 60
        && entry.detailRefs.includes('detail:service:4'))), true,
    'active rollback 必须保留目标楼层可见的 snapshot manifest 引用');
assert.equal(resolveTodayTrendV2DetailForTarget(
    phase9ActiveRolledBack, 'chat', 'service', 'detail:service:4', 60,
)?.text, '完成阶段详情', 'active rollback 后目标楼层 detail 仍须通过同一 manifest 可见性链读取');
const phase9EvictedRoot = phase9ActiveSnapshotPayload.generationSnapshots.find(snapshot => snapshot.assistantCount === 46)
    ?.checkpointRef?.rootEntityId;
assert.equal(phase9BoundedManifestPayload.generationSnapshots.some(snapshot => snapshot.checkpointRef?.rootEntityId === phase9EvictedRoot), false,
    '超过 12 上限后必须淘汰旧 checkpoint ref');
if (phase9EvictedRoot && !phase9BoundedManifestPayload.generationSnapshots.some(snapshot =>
    snapshot.checkpointRef?.rootEntityId === phase9EvictedRoot)) {
    assert.equal(Object.hasOwn(phase9BoundedManifestPayload.checkpointEntityStore, phase9EvictedRoot), false,
        '淘汰 checkpoint 后只 GC 已无 retained root reachability 的孤儿 root entity');
}
const phase9ArchivedFromManifestFacade = buildReadOnlyShadow(phase9BoundedManifestStore).scopes.chat;
const phase9ArchivedFromManifestEvent = phase9ArchivedFromManifestFacade.dynamics.active.find(event => event.id === 'service');
phase9ArchivedFromManifestFacade.dynamics.active = phase9ArchivedFromManifestFacade.dynamics.active
    .filter(event => event.id !== 'service');
phase9ArchivedFromManifestFacade.dynamics.archived.push({
    ...phase9ArchivedFromManifestEvent, lifecycle: 'archived', outcome: 'resolved', finalResult: '完成',
    updatedAt: phase9ArchivedFromManifestEvent.updatedAt + 1,
});
const phase9ArchivedFromManifest = applyTodayTrendGenerationToV2(
    phase9BoundedManifestStore, 'chat', phase9ArchivedFromManifestFacade, { events: [] },
    { assistantCount: 71, generatedAt: 71 },
);
const phase9ArchivedFromManifestPayload = phase9ArchivedFromManifest.globalEnvelope.payload.scopes.chat.payload;
assert.equal(Object.keys(phase9ArchivedFromManifestPayload.archivedRemovableDataByEvent.service.manifestsById).length, 1,
    'active→archived 必须保留同一稳定 manifest，不得复制或丢失');
assert.equal(resolveTodayTrendV2DetailForTarget(
    phase9ArchivedFromManifest, 'chat', 'service', 'detail:service:4', 71,
)?.text, '完成阶段详情', 'active→archived 后同一 detail 必须保持可读性连续');

const phase9ResolverStore = structuredClone(phase8ArchivedStore);
const phase9ResolverPayload = phase9ResolverStore.globalEnvelope.payload.scopes.chat.payload;
const phase9ResolverDetailId = 'detail:service:4';
const phase9ResolverManifestId = 'manifest:service:1';
phase9ResolverPayload.archivedRemovableDataByEvent.service.manifestsById[phase9ResolverManifestId] = {
    id: phase9ResolverManifestId,
};
phase9ResolverPayload.removableEntityStateById[phase9ResolverManifestId] = {
    entityType: 'manifest', entityId: phase9ResolverManifestId, eventId: 'service', state: 'available',
    removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
};
const phase9ResolverSnapshot = structuredClone(phase9ResolverPayload.generationSnapshots.at(-1));
Object.assign(phase9ResolverSnapshot, {
    assistantCount: 46, visibleFromAssistantCount: 46,
    detailManifestRefs: [{
        eventId: 'service', manifestId: phase9ResolverManifestId, detailRefs: [phase9ResolverDetailId],
        visibleFromAssistantCount: 46,
    }],
});
phase9ResolverPayload.generationSnapshots = [phase9ResolverSnapshot];
const phase9ResolvedDetail = resolveTodayTrendV2DetailForTarget(
    phase9ResolverStore, 'chat', 'service', phase9ResolverDetailId, 46,
);
assert.equal(phase9ResolvedDetail?.text, '完成阶段详情',
    'detail resolver 仅在正文、summary 来源楼层、manifest 可见性与 available lifecycle 全部满足时返回正文');
phase9ResolvedDetail.text = '调用方篡改';
assert.equal(phase9ResolverPayload.stageDetailsByEvent.service[0].text, '完成阶段详情',
    'detail resolver 返回值必须与 canonical 正文隔离');
for (const target of [null, -1, 45]) {
    assert.equal(resolveTodayTrendV2DetailForTarget(
        phase9ResolverStore, 'chat', 'service', phase9ResolverDetailId, target,
    ), null, `detail resolver 必须拒绝无效或早于来源的目标楼层 ${target}`);
}
assert.equal(resolveTodayTrendV2DetailForTarget(
    phase9ResolverStore, 'missing', 'service', phase9ResolverDetailId, 46,
), null, 'detail resolver 必须拒绝不存在的 canonical scope');
const phase9Unmanifested = structuredClone(phase9ResolverStore);
phase9Unmanifested.globalEnvelope.payload.scopes.chat.payload.generationSnapshots[0].detailManifestRefs = [];
assert.equal(resolveTodayTrendV2DetailForTarget(
    phase9Unmanifested, 'chat', 'service', phase9ResolverDetailId, 46,
), null, 'detail resolver 必须拒绝未被可见 manifest 引用的正文');
const phase9RemovedDetail = structuredClone(phase9ResolverStore);
const phase9RemovedPayload = phase9RemovedDetail.globalEnvelope.payload.scopes.chat.payload;
delete phase9RemovedPayload.stageDetailsByEvent.service;
phase9RemovedPayload.removableEntityStateById[phase9ResolverDetailId] = {
    ...phase9RemovedPayload.removableEntityStateById[phase9ResolverDetailId], state: 'removed',
    removalReason: 'archived-retention', removedAtAssistantCount: 47,
};
phase9RemovedPayload.removableEntityTombstonesById[phase9ResolverDetailId] =
    structuredClone(phase9RemovedPayload.removableEntityStateById[phase9ResolverDetailId]);
const phase9RemovedResolution = resolveTodayTrendV2DetailForTarget(
    phase9RemovedDetail, 'chat', 'service', phase9ResolverDetailId, 47,
);
assert.deepEqual(phase9RemovedResolution, {
    status: 'unavailable', code: 'TT_DETAIL_REMOVED', detailId: phase9ResolverDetailId, eventId: 'service',
    removalReason: 'archived-retention', removedAtAssistantCount: 47,
}, 'detail resolver 必须明确区分 removed unavailable 与 unknown');
assert.equal(JSON.stringify(phase9RemovedResolution).includes('完成阶段详情'), false,
    'removed unavailable 诊断不得泄漏 detail 正文');
const phase9HistoricalDetail = structuredClone(phase9ActiveSnapshotStore);
const phase9HistoricalPayload = phase9HistoricalDetail.globalEnvelope.payload.scopes.chat.payload;
phase9HistoricalPayload.operation = {
    ...phase9HistoricalPayload.operation, lastSuccessfulAssistantCount: 47, lastSuccessfulRunAt: 47,
};
delete phase9HistoricalPayload.stageDetailsByEvent.service;
phase9HistoricalPayload.removableEntityStateById[phase9ResolverDetailId] = {
    ...phase9HistoricalPayload.removableEntityStateById[phase9ResolverDetailId],
    state: 'removed', removalReason: 'archived-retention', removedAtAssistantCount: 47,
};
phase9HistoricalPayload.removableEntityTombstonesById[phase9ResolverDetailId] =
    structuredClone(phase9HistoricalPayload.removableEntityStateById[phase9ResolverDetailId]);
assert.equal(resolveTodayTrendV2DetailForTarget(
    phase9HistoricalDetail, 'chat', 'service', phase9ResolverDetailId, 46,
)?.text, '完成阶段详情', '当前 #47 删除 detail 时，读取 #46 必须从 retained checkpoint 恢复正文');
assert.equal(resolveTodayTrendV2DetailForTarget(
    phase9HistoricalDetail, 'chat', 'service', phase9ResolverDetailId, 47,
)?.status, 'unavailable', '当前 #47 已删除的 detail 必须保持 unavailable');


const phase9ScopeV3 = normalizeTodayTrendV2Store(phase9ActiveSnapshotStore);
assert.equal(phase9ScopeV3.globalEnvelope.schemaVersion, 2, 'scope v3 不得改写全局 envelope v2');
assert.equal(phase9ScopeV3.globalEnvelope.payload.scopes.chat.schemaVersion, 3, 'canonical scope envelope 必须升级为 v3');
const phase9ScopeV2 = structuredClone(phase9ScopeV3);
phase9ScopeV2.globalEnvelope.payload.scopes.chat.schemaVersion = 2;
const phase9LegacyEmbeddedPayload = rollbackTodayTrendV2Scope(phase9ScopeV3, 'chat', 46)
    .globalEnvelope.payload.scopes.chat.payload;
delete phase9LegacyEmbeddedPayload.generationSnapshots;
delete phase9LegacyEmbeddedPayload.checkpointEntityStore;
delete phase9LegacyEmbeddedPayload.commitJournal;
for (const snapshot of phase9ScopeV2.globalEnvelope.payload.scopes.chat.payload.generationSnapshots) {
    delete snapshot.checkpointRef;
    snapshot.restoreCapability = 'full';
    snapshot.checkpoint = structuredClone(phase9LegacyEmbeddedPayload);
    snapshot.checkpointDigest = 'legacy-untrusted-digest';
}
delete phase9ScopeV2.globalEnvelope.payload.scopes.chat.payload.checkpointEntityStore;
const phase9MigratedV3 = normalizeTodayTrendV2Store(phase9ScopeV2);
assert.equal(phase9MigratedV3.globalEnvelope.payload.scopes.chat.schemaVersion, 3,
    '历史 scope v2 full checkpoint 必须受限迁移为 v3');
assert.ok(phase9MigratedV3.globalEnvelope.payload.scopes.chat.payload.generationSnapshots
    .every(snapshot => snapshot.restoreCapability === 'projection-only' && snapshot.checkpointRef === null),
    '历史 scope v2 snapshot 一律只能迁移为 projection-only，不得成为 reroll authority');
assert.throws(() => rollbackTodayTrendV2Scope(phase9MigratedV3, 'chat', 46),
    error => error?.code === 'TT_CANONICAL_CHECKPOINT_INCOMPLETE',
    '即使旧 v2 内嵌对象形似完整 payload，也不得升级为 rollback/reroll authority');
assert.deepEqual(normalizeTodayTrendV2Store(phase9MigratedV3), phase9MigratedV3,
    'scope v2→v3 迁移结果必须幂等');
assert.throws(() => normalizeTodayTrendV2Store({
    ...structuredClone(phase9MigratedV3),
    globalEnvelope: {
        ...structuredClone(phase9MigratedV3.globalEnvelope),
        payload: { ...structuredClone(phase9MigratedV3.globalEnvelope.payload), scopes: {
            chat: { ...structuredClone(phase9MigratedV3.globalEnvelope.payload.scopes.chat), schemaVersion: 4 },
        } },
    },
}), error => error?.code === 'TT_V2_FUTURE_VERSION', 'future scope envelope 必须 fail-closed');
const phase9TamperedCheckpoint = structuredClone(phase9ScopeV3);
const phase9TamperedPayload = phase9TamperedCheckpoint.globalEnvelope.payload.scopes.chat.payload;
const phase9TamperedEntityId = Object.keys(phase9TamperedPayload.checkpointEntityStore)[0];
phase9TamperedPayload.checkpointEntityStore[phase9TamperedEntityId].kind = 'tampered';
assert.throws(() => normalizeTodayTrendV2Store(phase9TamperedCheckpoint),
    error => error?.code === 'TT_CANONICAL_CHECKPOINT_INTEGRITY', '篡改 checkpoint entity 必须产生稳定完整性诊断');

const phase9UnknownDetail = resolveTodayTrendV2DetailForTarget(
    phase9RemovedDetail, 'chat', 'service', 'detail:service:999', 47,
);
assert.equal(phase9UnknownDetail, null, '未知 detail 必须继续 fail-closed，不得伪装为 removed unavailable');

const phase9BranchSource = structuredClone(phase8Cleaned.globalEnvelope.payload.scopes.chat);
const phase9BranchPayload = phase9BranchSource.payload;
phase9BranchPayload.operation.lastSuccessfulAssistantCount = 33;
phase9BranchPayload.historyRetentionState.highWaterAssistantCount = 33;
const phase9SnapshotTemplate = structuredClone(phase9BranchPayload.generationSnapshots.at(-1));
phase9BranchPayload.generationSnapshots = Array.from({ length: 12 }, (_, index) => ({
    ...structuredClone(phase9SnapshotTemplate),
    assistantCount: 33 + index,
    visibleFromAssistantCount: 33 + index,
    detailManifestRefs: phase9SnapshotTemplate.detailManifestRefs.map(entry => ({
        ...structuredClone(entry), visibleFromAssistantCount: 33 + index,
    })),
}));
const phase9Presets = phase8Cleaned.globalEnvelope.payload.presets;
const phase9CopiedEnvelope = copyTodayTrendV2ScopeForBranch(phase9BranchSource, 'phase9-branch', 20, phase9Presets);
const phase9CopiedPayload = phase9CopiedEnvelope.payload;
assert.equal(phase9CopiedEnvelope.revision, 0, '分支 canonical envelope 必须从独立 revision 0 开始');
assert.equal(phase9CopiedPayload.storageId, 'phase9-branch', '分支 canonical payload 必须改写 storageId');
assert.equal(phase9CopiedPayload.commitJournal, null, '分支 canonical payload 不得继承来源 journal');
assert.equal(phase9CopiedPayload.operation.lastSuccessfulAssistantCount, 20,
    '分支 canonical checkpoint 必须平移到目标 assistant 楼层');
assert.equal(phase9CopiedPayload.operation.lastSuccessfulRunAt, 0, '分支 canonical 成功时间必须重置');
assert.equal(phase9CopiedPayload.historyRetentionState.highWaterAssistantCount, 20,
    '分支 canonical 非 null 高水位必须按 source/target offset 平移');
assert.equal(phase9CopiedPayload.generationSnapshots.length, 12, '分支 canonical snapshot 必须裁剪到最多 12 个');
assert.deepEqual(phase9CopiedPayload.generationSnapshots.map(snapshot => snapshot.assistantCount),
    Array.from({ length: 12 }, (_, index) => 20 + index), '分支 canonical snapshot 必须平移并按楼层升序保留最多 12 个');
for (const snapshot of phase9CopiedPayload.generationSnapshots) {
    assert.equal(snapshot.visibleFromAssistantCount, snapshot.assistantCount,
        '分支 snapshot 可见边界必须与楼层使用同一 offset 平移');
    assert.ok(snapshot.detailManifestRefs.every(entry => entry.visibleFromAssistantCount === snapshot.assistantCount),
        '分支 manifest 可见边界必须与 snapshot 同步平移');
    assert.equal(Object.hasOwn(snapshot, 'stageDetailsByEvent'), false, 'canonical snapshot 不得复制 detail 正文');
    assert.equal(Object.hasOwn(snapshot, 'archivedRemovableDataByEvent'), false,
        'canonical snapshot 不得复制 archived removable 正文容器');
    assert.equal(Object.hasOwn(snapshot, 'checkpoint'), false, 'canonical snapshot 不得内嵌完整 checkpoint payload');
    if (snapshot.restoreCapability === 'full') rollbackTodayTrendV2Scope({ version: 2, globalEnvelope: { schemaVersion: 2,
        revision: 0, payload: { presets: phase9Presets, scopes: { 'phase9-branch': phase9CopiedEnvelope } } } }, 'phase9-branch', snapshot.assistantCount);
}
for (const state of Object.values(phase9CopiedPayload.removableEntityStateById)) {
    assert.equal(state.state, 'removed', '分支复制不得复活 removed lifecycle');
    assert.equal(state.removedAtAssistantCount, 20, '分支 removed 审计楼层必须按同一 offset 平移');
}
const phase9UnknownHighWater = structuredClone(phase9BranchSource);
phase9UnknownHighWater.payload.historyRetentionState.highWaterAssistantCount = null;
for (const field of ['removableEntityStateById', 'removableEntityTombstonesById']) {
    for (const state of Object.values(phase9UnknownHighWater.payload[field])) {
        state.removedAtAssistantCount = null;
    }
}
const phase9UnknownCopied = copyTodayTrendV2ScopeForBranch(
    phase9UnknownHighWater, 'phase9-unknown', 0, phase9Presets,
).payload;
assert.equal(phase9UnknownCopied.historyRetentionState.highWaterAssistantCount, null, '分支复制必须保持 unknown 高水位为 null');
assert.ok(Object.values(phase9UnknownCopied.removableEntityStateById).every(state => state.removedAtAssistantCount === null),
    '分支复制必须保持 unknown removed 审计楼层为 null');

const phase8FixedCoreRewrite = structuredClone(phase8ArchivedStore);
const phase8FixedCoreRewritePayload = phase8FixedCoreRewrite.globalEnvelope.payload.scopes.chat.payload;
const phase8RewrittenArchived = phase8FixedCoreRewritePayload.dynamics.archived.find(event => event.id === phase4EventId);
phase8RewrittenArchived.title = '被非法改写的归档标题';
phase8FixedCoreRewritePayload.fixedCoreBaselineByEvent[phase4EventId] = extractArchivedFixedCore(phase8RewrittenArchived);
assert.throws(() => validateTodayTrendV2Transition(phase8ArchivedStore, phase8FixedCoreRewrite),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', '同步篡改 archived event 与 baseline 也不得绕过 fixed-core 不可变门禁');
const phase8SequenceGap = structuredClone(phase8ArchiveBase);
phase8SequenceGap.globalEnvelope.payload.scopes.chat.payload.historyRetentionState.nextArchivedSequence += 1;
assert.throws(() => validateTodayTrendV2Transition(phase8ArchiveBase, phase8SequenceGap),
    error => error?.code === 'TT_V2_SCHEMA_INVALID', '没有归档事务时不得凭空推进 nextArchivedSequence');

const phase10PromptScope = serializeTodayTrendV2ScopeForGeneration(phase9ArchivedFromManifest, 'chat');
assert.ok(phase10PromptScope.length <= 12000, '常规 AI canonical serializer 必须限制 current_today_trend 在 12000 字符内');
assert.match(phase10PromptScope, /"kind":"day-summary"/, '常规 AI serializer 必须保留折叠日期摘要投影');
assert.doesNotMatch(phase10PromptScope, /完成阶段详情/, '常规 AI serializer 不得泄漏 folded stage-detail 正文');
assert.doesNotMatch(phase10PromptScope, /detailRefs|stageDetailsByEvent|archivedRemovableDataByEvent|removableEntityStateById|Tombstones|"lifecycle"/,
    '常规 AI serializer 不得泄漏 detail 引用或 removable 内部状态');
assert.equal(serializeTodayTrendV2ScopeForGeneration(phase9ArchivedFromManifest, 'missing'), null,
    '常规 AI serializer 必须拒绝不存在的 canonical scope');
const phase10PromptEnvelope = buildTodayTrendGenerationEnvelope({
    context: collectedContext, preset: valid.presets.preset, scope: valid.scopes.chat, promptScope: phase10PromptScope,
});
assert.match(phase10PromptEnvelope.userPrompt, /"kind\\":\\"day-summary\\"/,
    '常规 AI envelope 必须使用 canonical summary serializer 的内容');
assert.doesNotMatch(phase10PromptEnvelope.userPrompt, /完成阶段详情/,
    '常规 AI envelope 不得回退到 facade 后泄漏 folded detail 正文');
const phase10SummaryOnlyPrompt = buildTodayTrendGenerationEnvelope({
    context: collectedContext, preset: valid.presets.preset, scope: valid.scopes.chat, summaryOnly: true,
});
assert.match(phase10SummaryOnlyPrompt.userPrompt, /本轮仅补充 history 摘要/, 'summary-only prompt 必须限制为 history 写入');
assert.match(phase10SummaryOnlyPrompt.systemPrompt, /顶层必须且只能有 world、reputation、factions、dynamics、history 五个键/,
    'summary-only 仍必须维持单次 AI 调用的五键闭集');
let phase10SchedulerStore = structuredClone(phase9ArchivedFromManifest);
let phase10PromptReads = 0, phase10GenerateCalls = 0;
const phase10Scheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope, summaryOnly, promptScope }) => {
        phase10GenerateCalls += 1;
        assert.equal(summaryOnly, true, 'summary-only scheduler 必须向唯一 AI 调用传递 fail-closed 标记');
        assert.equal(promptScope, phase10PromptScope, 'canonical scheduler 必须将 summary serializer 结果传给唯一 AI 调用');
        return { scope, history: { events: [] } };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        commitStore: async (mutate, _task, options) => {
            assert.deepEqual(options, { canonical: true, scopeId: 'chat' }, 'summary-only 仍必须走 canonical 单事务提交链');
            phase10SchedulerStore = await mutate(structuredClone(phase10SchedulerStore));
            return buildReadOnlyShadow(phase10SchedulerStore);
        },
    },
    getStore: async () => buildReadOnlyShadow(phase10SchedulerStore), getStorageId: () => 'chat', getFloor: () => 71,
    getPromptScope: async storageId => { phase10PromptReads += 1; return serializeTodayTrendV2ScopeForGeneration(phase10SchedulerStore, storageId); },
});
await phase10Scheduler.run({ kind: 'manual', floor: 71, summaryOnly: true });
assert.equal(phase10PromptReads, 1, 'summary-only 每楼层必须只读取一次 canonical prompt projection');
assert.equal(phase10GenerateCalls, 1, 'summary-only 每楼层必须只发起一次 AI 调用');

const phase10UiScope = resolveTodayTrendV2UiScope(phase9ResolverStore, 'chat');
assert.ok(phase10UiScope, 'UI canonical resolver 必须返回现存 scope');
const phase11RetentionState = resolveTodayTrendV2RetentionSettingsState(phase9ResolverStore, 'chat');
assert.deepEqual(phase11RetentionState, {
    scopeRevision: phase9ResolverStore.globalEnvelope.payload.scopes.chat.revision,
    settingsRevision: phase9ResolverStore.globalEnvelope.payload.scopes.chat.payload.historyRetentionSettings.revision,
}, 'retention CAS resolver 必须只返回 scope/settings revision');
assert.equal(resolveTodayTrendV2RetentionSettingsState(phase9ResolverStore, 'missing'), null,
    'retention CAS resolver 必须对不存在 scope fail-closed');
assert.deepEqual(Object.keys(phase11RetentionState).sort(), ['scopeRevision', 'settingsRevision'],
    'retention CAS resolver 不得暴露 store revision 或 retention 内部状态');
assert.throws(() => saveTodayTrendRetentionSettingsToV2(phase9ResolverStore, 'missing', {
    archivedDetailLatestEventCount: '2', archivedDetailRetentionFloors: '20',
}, { expectedScopeRevision: 0, expectedSettingsRevision: 1 }),
error => error?.code === 'TT_V2_SCHEMA_INVALID', 'retention 保存必须拒绝不存在的 canonical scope');
for (const revisions of [
    {},
    { expectedScopeRevision: -1, expectedSettingsRevision: 1 },
    { expectedScopeRevision: phase11RetentionState.scopeRevision, expectedSettingsRevision: 0 },
]) {
    assert.throws(() => saveTodayTrendRetentionSettingsToV2(phase9ResolverStore, 'chat', {
        archivedDetailLatestEventCount: '2', archivedDetailRetentionFloors: '20',
    }, revisions), error => error?.code === 'TT_RETENTION_SETTINGS_INVALID',
    'retention 保存必须拒绝缺失或非法 base revision');
}
assert.throws(() => saveTodayTrendRetentionSettingsToV2(phase9ResolverStore, 'chat', {
    archivedDetailLatestEventCount: '2.0', archivedDetailRetentionFloors: '20',
}, {
    expectedScopeRevision: phase11RetentionState.scopeRevision,
    expectedSettingsRevision: phase11RetentionState.settingsRevision,
}), error => error?.code === 'TT_RETENTION_SETTINGS_INVALID',
'retention 保存必须拒绝非十进制整数字符串');
let phase11InstalledCanonical = structuredClone(phase9ResolverStore);
let phase11CommitOptions = null;
const phase11InstalledDeps = {
    runtime: {}, getStorageId: () => 'chat', getLastMessageId: () => 40,
    getCtx: () => ({ characterId: 'character', characters: { character: { avatar: 'character', name: '小明' } }, chat: [] }),
    callAI: async () => { throw new Error('retention 保存契约测试不应调用 AI'); },
    loadTodayTrendStore: async () => buildReadOnlyShadow(phase11InstalledCanonical),
    saveTodayTrendStore: async value => value,
    createTodayTrendGenerationController: () => ({
        generate: async () => { throw new Error('retention 保存契约测试不应生成'); },
        initialize: async () => { throw new Error('retention 保存契约测试不应初始化'); },
        regenerateRule: async () => { throw new Error('retention 保存契约测试不应重生成'); },
    }),
    createTodayTrendCommitter: () => ({
        ready: async () => [], isBlocked: () => false, supportsCanonical: true, invalidateCommits() {},
        loadCanonical: async () => structuredClone(phase11InstalledCanonical),
        commitStore: async (mutate, _task, options) => {
            phase11CommitOptions = options;
            const previous = structuredClone(phase11InstalledCanonical);
            const candidate = await mutate(structuredClone(previous));
            const nextScopeRevision = previous.globalEnvelope.payload.scopes.chat.revision + 1;
            candidate.globalEnvelope.revision += 1;
            candidate.globalEnvelope.payload.scopes.chat.revision = nextScopeRevision;
            phase11InstalledCanonical = normalizeTodayTrendV2Store(candidate);
            return buildReadOnlyShadow(phase11InstalledCanonical);
        },
    }),
};
installTodayTrend({}, phase11InstalledDeps);
const phase11DetailBefore = JSON.stringify({
    stageDetailsByEvent: phase11InstalledCanonical.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent,
    archivedRemovableDataByEvent: phase11InstalledCanonical.globalEnvelope.payload.scopes.chat.payload.archivedRemovableDataByEvent,
    removableEntityStateById: phase11InstalledCanonical.globalEnvelope.payload.scopes.chat.payload.removableEntityStateById,
    removableEntityTombstonesById: phase11InstalledCanonical.globalEnvelope.payload.scopes.chat.payload.removableEntityTombstonesById,
});
const phase11SavedThroughInstall = await phase11InstalledDeps.saveTodayTrendRetentionSettings({
    storageId: 'chat', archivedDetailLatestEventCount: '0', archivedDetailRetentionFloors: '33',
    expectedScopeRevision: phase11RetentionState.scopeRevision,
    expectedSettingsRevision: phase11RetentionState.settingsRevision,
});
assert.deepEqual(phase11CommitOptions, { canonical: true, scopeId: 'chat' },
    '安装层 retention 保存必须走 canonical commitStore 单事务并声明 scopeId');
assert.deepEqual(phase11SavedThroughInstall.scope.historyRetentionSettings,
    { archivedDetailLatestEventCount: 0, archivedDetailRetentionFloors: 33, revision: phase11RetentionState.settingsRevision + 1 },
    '安装层 retention 保存必须返回重新读取的 committed UI scope');
assert.equal(phase11SavedThroughInstall.revisions.scopeRevision, phase11RetentionState.scopeRevision + 1,
    '安装层 retention 保存返回的 CAS revision 必须来自提交后的 canonical store');
assert.equal(JSON.stringify({
    stageDetailsByEvent: phase11InstalledCanonical.globalEnvelope.payload.scopes.chat.payload.stageDetailsByEvent,
    archivedRemovableDataByEvent: phase11InstalledCanonical.globalEnvelope.payload.scopes.chat.payload.archivedRemovableDataByEvent,
    removableEntityStateById: phase11InstalledCanonical.globalEnvelope.payload.scopes.chat.payload.removableEntityStateById,
    removableEntityTombstonesById: phase11InstalledCanonical.globalEnvelope.payload.scopes.chat.payload.removableEntityTombstonesById,
}), phase11DetailBefore, '安装层 retention 保存不得扫描、删除或改写 removable 容器');
await assert.rejects(() => phase11InstalledDeps.saveTodayTrendRetentionSettings({
    storageId: 'chat', archivedDetailLatestEventCount: '2', archivedDetailRetentionFloors: '20',
    expectedScopeRevision: phase11RetentionState.scopeRevision,
    expectedSettingsRevision: phase11RetentionState.settingsRevision,
}), error => error?.code === 'TT_SETTINGS_REVISION_CONFLICT', '安装层 retention 保存必须拒绝迟到 revision');
for (const field of ['capacityCompatibilityPending', 'archivedSequence', 'archivedAtAssistantCount',
    'historyRetentionState', 'removableEntityStateById', 'removableEntityTombstonesById', 'generationSnapshots',
    'stageDetailsByEvent', 'archivedRemovableDataByEvent']) {
    assert.equal(Object.hasOwn(phase10UiScope, field), false, `UI projection 不得暴露内部字段 ${field}`);
}
assert.deepEqual(phase10UiScope.historyRetentionSettings, {
    archivedDetailLatestEventCount: phase9ResolverStore.globalEnvelope.payload.scopes.chat.payload.historyRetentionSettings.archivedDetailLatestEventCount,
    archivedDetailRetentionFloors: phase9ResolverStore.globalEnvelope.payload.scopes.chat.payload.historyRetentionSettings.archivedDetailRetentionFloors,
    revision: phase9ResolverStore.globalEnvelope.payload.scopes.chat.payload.historyRetentionSettings.revision,
}, 'UI projection 必须只暴露 N、L 与 settings revision');
assert.deepEqual(Object.keys(phase10UiScope.historyRetentionSettings).sort(),
    ['archivedDetailLatestEventCount', 'archivedDetailRetentionFloors', 'revision'].sort(),
    'UI retention projection 必须保持字段闭集');
const phase10UiEvent = phase10UiScope.dynamics.archived.find(event => event.id === 'service');
assert.ok(phase10UiEvent, 'UI projection 必须保留 archived event');
assert.ok(phase10UiEvent.stages.some(stage => stage.kind === 'day-summary' && stage.displayText),
    'UI stage projection 必须为 day-summary 提供非空 displayText');
const phase10UiHtml = renderTodayTrendDynamicsView({
    scope: phase10UiScope,
    dynamicsTab: 'archived',
    detailById: { [phase9ResolverDetailId]: { status: 'available', text: '完成阶段详情' } },
});
assert.match(phase10UiHtml, /data-action="today-trend-load-detail"/, 'UI 必须为 detail ref 输出按需读取动作');
assert.match(phase10UiHtml, /完成阶段详情/, '可用 detail 必须渲染正文');
const phase10UiUnavailableHtml = renderTodayTrendDynamicsView({
    scope: phase10UiScope,
    dynamicsTab: 'archived',
    detailById: { [phase9ResolverDetailId]: { status: 'unavailable', text: '' } },
});
assert.match(phase10UiUnavailableHtml, /详情不可用/, '不可用 detail 必须 fail-closed 并保留摘要');
assert.match(phase10UiUnavailableHtml, /data-action="today-trend-load-detail"[^>]* disabled/, '不可用 detail 不得继续显示为可点击重试入口');
let phase10DetailCalls = [];
const phase10DetailListeners = {};
const phase10DetailDispatcher = createTodayTrendActionDispatcher({
    container: { addEventListener: (type, listener) => { phase10DetailListeners[type] = listener; }, removeEventListener: () => {}, contains: () => true },
    getStorageId: () => 'chat', getStore: async () => phase9ResolverStore,
    committer: { commitScope: async () => phase9ResolverStore }, render: async () => {},
    onLoadDetail: async (...args) => { phase10DetailCalls.push(args); },
});
const phase10DetailButton = { disabled: false, dataset: { action: 'today-trend-load-detail', eventId: 'service', detailId: phase9ResolverDetailId }, closest: () => phase10DetailButton };
phase10DetailListeners.click({ target: phase10DetailButton });
await Promise.resolve();
assert.deepEqual(phase10DetailCalls, [['service', phase9ResolverDetailId]], 'detail UI action 必须经 dispatcher 传递 eventId/detailId');
phase10DetailDispatcher.destroy();

const phase11SettingsHtml = renderTodayTrendSettingsView({
    scope: phase10UiScope, presets: Object.values(valid.presets), retentionRevisions: phase11RetentionState,
});
const phase12BatchOffHtml = renderTodayTrendSettingsView({
    scope: phase10UiScope, presets: Object.values(valid.presets), assistantCount: 8,
});
assert.match(phase12BatchOffHtml, /name="batchEnabled"[^>]*role="switch"/, '批处理默认必须提供关闭状态开关');
assert.doesNotMatch(phase12BatchOffHtml, /name="recentAssistantCount"/, '批处理关闭时必须隐藏最近处理层数等展开详情');
assert.doesNotMatch(phase12BatchOffHtml, /name="mergeAssistantCount"/, '批处理关闭时必须隐藏合并层数等展开详情');
assert.doesNotMatch(phase12BatchOffHtml, /data-action="today-trend-batch-generate"/, '批处理未启用时不得显示手动更新动作');
const phase12BatchOnHtml = renderTodayTrendSettingsView({
    scope: phase10UiScope, presets: Object.values(valid.presets), assistantCount: 8,
    batchDraft: { enabled: true, recentAssistantCount: 4, mergeAssistantCount: 2 },
});
assert.match(phase12BatchOnHtml, /name="batchEnabled"[^>]*checked/, '批处理开启状态必须反映在开关上');
assert.doesNotMatch(phase12BatchOnHtml, /generationSnapshots/, '批量设置不得再显示固定容量说明');
assert.match(phase12BatchOnHtml, /name="recentAssistantCount"[^>]*max="8"/, '批处理窗口上限必须来自当前 assistantCount');
assert.match(phase12BatchOnHtml, /data-action="today-trend-batch-generate"/, '开启批处理后必须显示手动更新动作');
assert.match(phase12BatchOnHtml, /手动处理最近AI回复层数/, '批处理开启后必须显示易懂的最近处理层数标签');
assert.match(phase12BatchOnHtml, /pm-today-trend-batch-stat/, '批处理开启后必须显示统计行');
const phase12FailedBatchHtml = renderTodayTrendSettingsView({
    scope: { ...phase10UiScope, storageId: 'chat', operation: { ...phase10UiScope.operation, lastSuccessfulAssistantCount: 3 } },
    presets: Object.values(valid.presets), assistantCount: 8,
    generation: { phase: 'failed', task: { storageId: 'chat', batchIndex: 1, batchCount: 3 }, lastError: '事件生命周期无效' },
    batchDraft: { enabled: true, recentAssistantCount: 5, mergeAssistantCount: 2 },
});
assert.match(phase12FailedBatchHtml, /已成功更新<\/span><b>3<\/b>/, '第二批失败后必须按最新成功边界显示已成功更新层数');
assert.match(phase12FailedBatchHtml, /当前未更新的 AI 回复累计层数<\/span><b>5<\/b>/, '第二批失败后必须按最新成功边界显示可续填累计层数');
assert.match(phase12FailedBatchHtml, /第 2\/3 批失败：事件生命周期无效。已成功批次已保留；可按未更新累计层数重填后继续。/,
    '第二批失败后必须显示精确批号、原始错误和续填提示');
const phase12BatchListeners = [];
let phase12GeneratedOptions = null;
let phase12UiScope = structuredClone(phase10UiScope);
let phase12SaveCalls = 0;
let phase12FailSaveCall = null;
const phase12BatchContainer = {
    innerHTML: '', contains: () => true,
    addEventListener: (type, listener, capture = false) => phase12BatchListeners.push({ type, listener, capture }),
    removeEventListener: () => {}, querySelector: () => null,
};
const phase12BatchController = createTodayTrendPhoneController({
    state: { phoneWindow: { querySelector: selector => selector === '.pm-today-trend-page' ? phase12BatchContainer : null } },
    container: phase12BatchContainer,
    deps: {
        getStorageId: () => 'chat', getTodayTrendStore: async () => ({ ...valid, scopes: { ...valid.scopes, chat: phase12UiScope } }),
        getTodayTrendUiScope: async () => phase12UiScope, getCtx: () => ({ chat: [{ role: 'user', content: '用户消息' }, { role: 'assistant', content: '助手一' }, { role: 'assistant', content: '助手二' }] }),
        getTodayTrendCurrentFloor: () => 33, getTodayTrendGenerationState: () => ({ phase: 'idle' }),
        subscribeTodayTrendGeneration: () => () => {},
        saveTodayTrendSettings: async ({ operation }) => {
            phase12SaveCalls += 1;
            if (phase12SaveCalls === phase12FailSaveCall) throw new Error('模拟批处理草稿保存失败');
            phase12UiScope.operation = { ...phase12UiScope.operation, ...operation };
            valid.scopes.chat.operation = { ...valid.scopes.chat.operation, ...operation };
            return { scope: phase12UiScope };
        },
        generateTodayTrend: options => { phase12GeneratedOptions = options; return Promise.resolve(); },
    },
});
await phase12BatchController.render();
const phase12OpenSettingsButton = { disabled: false, dataset: { action: 'today-trend-open-settings' }, closest: selector => selector === 'button[data-action]' ? phase12OpenSettingsButton : null };
phase12BatchListeners.find(item => item.type === 'click' && item.capture)?.listener({ target: phase12OpenSettingsButton });
await new Promise(resolve => setTimeout(resolve, 10));
const phase12BatchToggle = { name: 'batchEnabled', disabled: false, checked: true, closest: selector => selector.includes('input[name="batchEnabled"]') ? phase12BatchToggle : null };
await phase12BatchListeners.find(item => item.type === 'change')?.listener({ target: phase12BatchToggle });
assert.match(phase12BatchContainer.innerHTML, /name="recentAssistantCount"/, 'controller 切换批处理开关后必须显示详情字段');
const phase12RecentInput = { name: 'recentAssistantCount', value: '4', disabled: false,
    closest: selector => selector.includes('input[name="recentAssistantCount"]') ? phase12RecentInput : null };
const phase12MergeInput = { name: 'mergeAssistantCount', value: '2', disabled: false,
    closest: selector => selector.includes('input[name="mergeAssistantCount"]') ? phase12MergeInput : null };
const phase12ChangeListener = phase12BatchListeners.find(item => item.type === 'change')?.listener;
const phase12RapidSaves = [phase12ChangeListener({ target: phase12RecentInput }), phase12ChangeListener({ target: phase12MergeInput })];
await Promise.all(phase12RapidSaves);
assert.deepEqual(phase12UiScope.operation.batchDraft, { enabled: true, recentAssistantCount: 4, mergeAssistantCount: 2 },
    '快速连续修改批处理参数不得因旧 render 快照覆盖已保存字段');
phase12FailSaveCall = phase12SaveCalls + 2;
const phase12Input = (name, value) => ({ name, value: String(value), disabled: false,
    closest() { return this; } });
const phase12FailedQueueSaves = [
    phase12ChangeListener({ target: phase12Input('recentAssistantCount', 5) }),
    phase12ChangeListener({ target: phase12Input('mergeAssistantCount', 3) }),
    phase12ChangeListener({ target: phase12Input('recentAssistantCount', 6) }),
];
await Promise.all(phase12FailedQueueSaves);
assert.equal(phase12SaveCalls, 6, '批处理草稿队列中单次保存失败后仍必须继续执行后续变更');
assert.deepEqual(phase12UiScope.operation.batchDraft, { enabled: true, recentAssistantCount: 6, mergeAssistantCount: 2 },
    '批处理草稿队列后续保存必须基于最近 canonical 状态合并，而不是丢失此前字段');
const phase12BatchForm = {
    values: new Map([['recentAssistantCount', '2'], ['mergeAssistantCount', '1']]),
    checkValidity: () => true, reportValidity: () => {},
};
const phase12FormData = globalThis.FormData;
globalThis.FormData = class { constructor(form) { this.values = form.values; } get(name) { return this.values.get(name) ?? null; } };
const phase12BatchButton = {
    disabled: false, dataset: { action: 'today-trend-batch-generate' },
    closest: selector => selector === 'button[data-action]' ? phase12BatchButton : selector === 'form[data-today-trend-form="batch-settings"]' ? phase12BatchForm : null,
};
await phase12BatchListeners.find(item => item.type === 'click' && item.capture)?.listener({ target: phase12BatchButton });
assert.deepEqual(phase12GeneratedOptions, { batchEnabled: true, recentAssistantCount: 2, mergeAssistantCount: 1 }, '批处理按钮必须透传调用级参数');
phase12BatchForm.checkValidity = () => false;
phase12GeneratedOptions = null;
phase12BatchListeners.find(item => item.type === 'click' && item.capture)?.listener({ target: phase12BatchButton });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(phase12GeneratedOptions, null, '非法批处理表单不得发起生成请求');
phase12BatchForm.checkValidity = () => true;
phase12BatchForm.values.set('recentAssistantCount', '4');
await phase12BatchListeners.find(item => item.type === 'click' && item.capture)?.listener({ target: phase12BatchButton });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(phase12GeneratedOptions, null, '超出当前聊天范围的批处理参数不得发起生成请求');
assert.match(phase12BatchContainer.innerHTML, /最近处理层数必须在当前聊天 AI 回复累计层数范围内/,
    '超出当前聊天范围的批处理参数必须显示错误，而非静默无响应');
globalThis.FormData = phase12FormData;
phase12BatchController.destroy();

let phase12RefreshCanonical = structuredClone(batchReadyValidV2);
let phase12RefreshGenerateCalls = 0;
let phase12RefreshReleaseFirstBatch;
const phase12RefreshStates = [];
let phase12RefreshGenerationListener = null;
const phase12RefreshChat = [
    { role: 'assistant', content: '提交边界第一批正文' },
    { role: 'assistant', content: '提交边界第二批正文' },
];
const phase12RefreshContainer = {
    innerHTML: '', contains: () => true,
    addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null,
};
const phase12RefreshController = createTodayTrendPhoneController({
    state: { phoneWindow: { querySelector: selector => selector === '.pm-today-trend-page' ? phase12RefreshContainer : null } },
    container: phase12RefreshContainer,
    deps: {
        getStorageId: () => 'chat',
        getTodayTrendStore: async () => buildReadOnlyShadow(phase12RefreshCanonical),
        getTodayTrendUiScope: async storageId => resolveTodayTrendV2UiScope(phase12RefreshCanonical, storageId),
        getCtx: () => ({ chat: phase12RefreshChat }), getTodayTrendCurrentFloor: () => 2,
        getTodayTrendGenerationState: () => phase12RefreshStates.at(-1) || { phase: 'idle', task: null },
        subscribeTodayTrendGeneration: listener => { phase12RefreshGenerationListener = listener; return () => {}; },
        generateTodayTrend: async () => {},
    },
});
await phase12RefreshController.render();
const phase12RefreshScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope, assistantCount }) => {
        phase12RefreshGenerateCalls += 1;
        if (phase12RefreshGenerateCalls === 1) {
            await new Promise(resolve => { phase12RefreshReleaseFirstBatch = resolve; });
        }
        const generatedScope = structuredClone(scope);
        generatedScope.world = { items: [{ id: `world-${assistantCount}`, name: '当前批世界态势',
            summary: assistantCount === 1 ? '首批提交后立即显示的 canonical 内容' : '第二批提交内容' }] };
        return { scope: generatedScope, history: { events: [] } };
    } },
    committer: {
        supportsCanonical: true, invalidateCommits: () => {},
        loadCanonical: async () => structuredClone(phase12RefreshCanonical),
        commitStore: async mutate => {
            phase12RefreshCanonical = await mutate(structuredClone(phase12RefreshCanonical));
            return buildReadOnlyShadow(phase12RefreshCanonical);
        },
    },
    getStore: async () => buildReadOnlyShadow(phase12RefreshCanonical), getStorageId: () => 'chat',
    getChat: () => phase12RefreshChat, getFloor: () => 2, commitFeedbackMs: 0,
});
const phase12RefreshUnsubscribe = phase12RefreshScheduler.subscribe(snapshot => {
    phase12RefreshStates.push(snapshot);
    phase12RefreshGenerationListener?.(snapshot);
});
const phase12RefreshRun = phase12RefreshScheduler.manual({ batchEnabled: true, recentAssistantCount: 2, mergeAssistantCount: 1 });
for (let index = 0; index < 100 && (typeof phase12RefreshReleaseFirstBatch !== 'function'
    || !phase12RefreshContainer.innerHTML.includes('pm-today-trend-floor-value">#0</')); index += 1) await Promise.resolve();
assert.equal(typeof phase12RefreshReleaseFirstBatch, 'function', '首批 AI 请求必须在清空提交后进入挂起态');
assert.equal(phase12RefreshGenerateCalls, 1, '清空提交完成后才允许开始首批 AI 请求');
assert.deepEqual(resolveTodayTrendV2UiScope(phase12RefreshCanonical, 'chat').world.items, [],
    '首批 AI 尚未返回时 canonical UI scope 必须已经删除旧世界内容');
assert.doesNotMatch(phase12RefreshContainer.innerHTML, /世界态势一|世界态势二|世界态势三/,
    '首批 AI 尚未返回时手机页面不得继续显示旧批次内容');
assert.match(phase12RefreshContainer.innerHTML, /pm-today-trend-floor-value">#0</,
    '全量重填首批尚未提交时，楼层必须显示已完成批次边界 #0，而不是宿主末楼层');
phase12RefreshReleaseFirstBatch();
for (let index = 0; index < 100 && (phase12RefreshGenerateCalls < 2 || !phase12RefreshContainer.innerHTML.includes('首批提交后立即显示的 canonical 内容')
    || !phase12RefreshContainer.innerHTML.includes('pm-today-trend-floor-value">#1</')); index += 1) await Promise.resolve();
const phase12FirstCommitSnapshot = phase12RefreshStates.find(snapshot => snapshot.phase === 'committing'
    && snapshot.task?.batchIndex === 0 && snapshot.task?.lastCommittedBatchIndex === 0);
assert.ok(phase12FirstCommitSnapshot, '首批 canonical 提交后必须立即发布可观察的提交边界 snapshot');
assert.equal(phase12RefreshGenerateCalls, 2, '首批提交完成后必须已进入第二批生成而不等待任务结束');
assert.match(phase12RefreshContainer.innerHTML, /首批提交后立即显示的 canonical 内容/,
    '第二批尚未完成时手机控制器必须由首批提交边界通知重绘最新 canonical 内容');
assert.match(phase12RefreshContainer.innerHTML, /pm-today-trend-floor-value">#1</,
    '第二批进行中楼层必须显示首批已提交的完成边界，而不是固定宿主末楼层');
await phase12RefreshRun;
phase12RefreshUnsubscribe();
phase12RefreshController.destroy();

const phase12NavigationListeners = [];
const phase12NavigationFocusLog = [];
const phase12NavigationScope = structuredClone(phase10UiScope);
delete phase12NavigationScope.operation.batchDraft;
const phase12NavigationInitialBatchDraft = structuredClone(phase12NavigationScope.operation.batchDraft);
let phase12NavigationSaveCalls = 0;
let phase12NavigationGenerateCalls = 0;
let phase12NavigationInitializeCalls = 0;
let phase12NavigationInitializeOptions = null;
const phase12NavigationFocusSelector = 'form[data-today-trend-form="batch-settings"] input[name="recentAssistantCount"]';
const phase12NavigationContainer = {
    innerHTML: '', contains: () => true,
    addEventListener: (type, listener, capture = false) => phase12NavigationListeners.push({ type, listener, capture }),
    removeEventListener: () => {},
    querySelector: selector => selector === phase12NavigationFocusSelector && phase12NavigationContainer.innerHTML.includes('name="recentAssistantCount"')
        ? { focus: () => phase12NavigationFocusLog.push(selector) } : null,
};
const phase12NavigationController = createTodayTrendPhoneController({
    state: { phoneWindow: { querySelector: selector => selector === '.pm-today-trend-page' ? phase12NavigationContainer : null } },
    container: phase12NavigationContainer,
    deps: {
        getStorageId: () => 'chat', getTodayTrendStore: async () => ({ ...valid, scopes: { ...valid.scopes, chat: phase12NavigationScope } }),
        getTodayTrendUiScope: async () => phase12NavigationScope,
        getCtx: () => ({ chat: [{ role: 'assistant', content: '助手一' }, { role: 'assistant', content: '助手二' }] }),
        getTodayTrendCurrentFloor: () => 33, getTodayTrendGenerationState: () => ({ phase: 'idle' }), subscribeTodayTrendGeneration: () => () => {},
        saveTodayTrendSettings: async () => { phase12NavigationSaveCalls += 1; },
        generateTodayTrend: async () => { phase12NavigationGenerateCalls += 1; },
        initializeTodayTrend: async options => {
            phase12NavigationInitializeCalls += 1;
            phase12NavigationInitializeOptions = options;
            phase12NavigationScope.operation = { ...phase12NavigationScope.operation,
                batchDraft: { enabled: true, recentAssistantCount: 2, mergeAssistantCount: 1 } };
        },
    },
});
await phase12NavigationController.render();
assert.doesNotMatch(phase12NavigationContainer.innerHTML, /data-today-trend-form="batch-settings"/,
    '隔离的初始化回填测试必须从非设置页开始，避免现有设置状态掩盖导航回归');
assert.doesNotMatch(phase12NavigationContainer.innerHTML, /today-trend-open-batch-settings|手动批量更新历史楼层/,
    '内容页不得保留已废弃的顶栏批量入口');
const phase12NavigationReinitializeButton = { disabled: false, dataset: { action: 'today-trend-reinitialize' }, closest: () => phase12NavigationReinitializeButton };
phase12NavigationListeners.find(item => item.type === 'click' && item.capture)?.listener({ target: phase12NavigationReinitializeButton });
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(phase12NavigationContainer.innerHTML, /data-today-trend-form="initialize"/,
    '重新初始化动作必须打开初始化表单，以便由用户选择回填开关与手动批量更新提交入口');
assert.deepEqual(phase12NavigationFocusLog, [], '进入初始化页不得提前伪造批量设置的焦点结果');
assert.equal(phase12NavigationSaveCalls, 0, '仅打开初始化页不得保存任何持久化设置');
assert.equal(phase12NavigationGenerateCalls, 0, '仅打开初始化页不得触发单次或批量生成');
assert.deepEqual(phase12NavigationScope.operation.batchDraft, phase12NavigationInitialBatchDraft,
    '仅打开初始化页不得改写 batchDraft');
const phase12NavigationFormData = globalThis.FormData;
globalThis.FormData = class { constructor(form) { this.values = form.values; } get(name) { return this.values.get(name) ?? null; } getAll(name) { const value = this.values.get(name); return Array.isArray(value) ? value : value === undefined ? [] : [value]; } };
const phase12NavigationInitializeForm = { dataset: { todayTrendForm: 'initialize' }, matches: selector => selector === 'form[data-today-trend-form]', checkValidity: () => true, reportValidity: () => {},
    values: new Map([['presetName', '初始预设'], ['worldBookNames', ['厨房']], ['includeExistingChat', 'on'], ['backfillExistingChat', 'on'], ['recentAssistantCount', '2'], ['mergeAssistantCount', '1']]) };
for (const listener of phase12NavigationListeners.filter(item => item.type === 'submit')) listener.listener({ target: phase12NavigationInitializeForm, submitter: { dataset: { action: 'today-trend-initialize-and-batch' } }, preventDefault() {} });
await new Promise(resolve => setTimeout(resolve, 0));
globalThis.FormData = phase12NavigationFormData;
assert.equal(phase12NavigationInitializeCalls, 1, '隔离初始化测试必须实际完成一次回填初始化调用');
assert.equal(phase12NavigationInitializeOptions?.runBackfill, true, '手动批量更新提交按钮必须显式请求初始化后批处理');
assert.match(phase12NavigationContainer.innerHTML, /data-today-trend-form="batch-settings"[\s\S]*name="recentAssistantCount"[^>]*value="2"/,
    '回填初始化成功后必须自动进入批量设置菜单');
assert.deepEqual(phase12NavigationFocusLog, [phase12NavigationFocusSelector],
    '回填初始化成功后必须且只能聚焦批量设置的最近处理层数输入框');
phase12NavigationController.destroy();
for (const [name, maximum] of [['archivedDetailLatestEventCount', 80], ['archivedDetailRetentionFloors', 1000]]) {
    assert.match(phase11SettingsHtml, new RegExp(`name="${name}"[^>]*min="0"[^>]*max="${maximum}"[^>]*step="1"[^>]*required`),
        `retention 设置必须为 ${name} 提供整数范围契约`);
}
for (const text of ['默认保留最近 2 个归档事件', '最近 20 楼', '保留归档事件数', '保留楼层数']) {
    assert.match(phase11SettingsHtml, new RegExp(text), `retention 设置必须显示简洁说明：${text}`);
}
for (const text of ['任一条件满足即保留', '设为 0 可关闭', '#32', '#12', '#33',
    'N&gt;0/L&gt;0', 'N&gt;0/L=0', 'N=0/L&gt;0', 'N=0/L=0', '阶段详情与日期摘要',
    '不会立即清理', '不可逆删除', '聊天回退不会恢复', '增大配置也不会复活已删除正文', '事件固定核心始终保留']) {
    assert.doesNotMatch(phase11SettingsHtml, new RegExp(text), `retention 设置不得再显示冗余说明：${text}`);
}
for (const text of ['组合语义', '示例：L=20', '保存只更新保留策略', 'canonical 修订信息不可用', '保存归档保留设置']) {
    assert.doesNotMatch(phase11SettingsHtml, new RegExp(text), `retention 设置不得再显示冗余说明：${text}`);
}
assert.match(phase11SettingsHtml, /name="expectedScopeRevision"[^>]*value="\d+"/, 'retention 表单必须携带 canonical scope revision');
assert.match(phase11SettingsHtml, /name="expectedSettingsRevision"[^>]*value="\d+"/, 'retention 表单必须携带 settings revision');
const phase11DiagnosticHtml = renderTodayTrendApp({
    scope: phase10UiScope, presets: Object.values(valid.presets), view: { name: 'settings' },
    retentionRevisions: phase11RetentionState,
    error: { message: '<script>冲突</script>', code: 'TT_SETTINGS_REVISION_CONFLICT' },
});
assert.match(phase11DiagnosticHtml, /<code>TT_SETTINGS_REVISION_CONFLICT<\/code>/, '结构化错误必须显示稳定 TT_* 诊断码');
assert.match(phase11DiagnosticHtml, /data-action="today-trend-copy-diagnostic-code"[^>]*data-code="TT_SETTINGS_REVISION_CONFLICT"/,
    '结构化错误必须提供只复制诊断码的动作');
assert.doesNotMatch(phase11DiagnosticHtml, /<script>/, '结构化错误 message 必须经过 HTML 转义');
assert.doesNotMatch(phase11DiagnosticHtml, /stageDetailsByEvent|commitJournal|detail:service/, '结构化错误 HTML 不得泄漏 canonical 内部正文或 journal');

const phase11DateScope = structuredClone(phase10UiScope);
const phase11DateEvent = phase11DateScope.dynamics.archived[0];
phase11DateScope.dynamics.active = [];
phase11DateScope.dynamics.archived = [phase11DateEvent];
phase11DateEvent.stages = [
    { id: 'day:a', kind: 'day-summary', storyDate: '2025-04-15', timeRange: { start: '07:20', end: '22:40', label: null }, displayText: '第一日摘要', detailRefs: [] },
    { id: 'day:b', kind: 'day-summary', storyDate: '2025-04-15', timeRange: null, displayText: '同日摘要', detailRefs: [] },
    { id: 'period:a', kind: 'period-summary', startDate: '2025-04-15', startTime: '07:20', endDate: '2025-04-16', endTime: '22:40', displayText: '跨日摘要', detailRefs: [] },
    { id: 'period:b', kind: 'period-summary', startDate: '2025-04-17', startTime: null, endDate: '2025-04-17', endTime: null, displayText: '同日时期摘要', detailRefs: [] },
    { id: 'undated:a', kind: 'undated-stage', storyDate: null, displayText: '无日期阶段', detailRefs: [] },
];
const phase11DateHtml = renderTodayTrendDynamicsView({ scope: phase11DateScope, dynamicsTab: 'archived' });
assert.equal((phase11DateHtml.match(/2025-04-15 · 07:20–22:40/g) || []).length, 1,
    '相邻同一日期只允许重复抑制后的首个日期标签携带 timeRange');
assert.match(phase11DateHtml, /2025-04-15 · 07:20–22:40/, 'day-summary 必须显示日期与可靠 timeRange');
assert.match(phase11DateHtml, /2025-04-15 07:20 – 2025-04-16 22:40/, 'period-summary 必须显示跨日期时期边界');
assert.match(phase11DateHtml, /datetime="2025-04-17">2025-04-17<\/time>/, '同日 period-summary 必须收敛为单日标签');
assert.doesNotMatch(phase11DateHtml, /无日期阶段[\s\S]*pm-today-trend-stage-date/, 'undated-stage 不得生成伪日期标签');
assert.doesNotMatch(phase11DateHtml, /sourceFloor|detail:|childSummaryRefs/, '日期 UI 不得输出内部 refs 或 source floor');

const phase11ControllerListeners = [];
let phase11ControllerStore = buildReadOnlyShadow(phase9ResolverStore);
let phase11ControllerScope = resolveTodayTrendV2UiScope(phase9ResolverStore, 'chat');
let phase11ControllerRevisions = resolveTodayTrendV2RetentionSettingsState(phase9ResolverStore, 'chat');
const phase11ConflictRevisions = { scopeRevision: phase11ControllerRevisions.scopeRevision + 1, settingsRevision: phase11ControllerRevisions.settingsRevision + 1 };
let phase11ControllerReloads = 0;
const phase11FocusLog = [];
const phase11FocusTargets = {
    'form[data-today-trend-form="retention-settings"] input:invalid': { focus: () => phase11FocusLog.push('invalid') },
    '.pm-today-trend-error': { focus: () => phase11FocusLog.push('conflict') },
};
let phase11RetentionSave = async () => { throw Object.assign(new Error('<script>设置已变化</script>'), { code: 'TT_SETTINGS_REVISION_CONFLICT' }); };
const phase11ControllerContainer = {
    innerHTML: '', contains: () => true,
    addEventListener: (type, listener, capture = false) => phase11ControllerListeners.push({ type, listener, capture }),
    removeEventListener: (type, listener, capture = false) => {
        const index = phase11ControllerListeners.findIndex(item => item.type === type && item.listener === listener && item.capture === capture);
        if (index >= 0) phase11ControllerListeners.splice(index, 1);
    },
    querySelector: selector => phase11FocusTargets[selector] || null,
};
const phase11ControllerState = { phoneWindow: { querySelector: selector => selector === '.pm-today-trend-page' ? phase11ControllerContainer : null } };
const phase11Controller = createTodayTrendPhoneController({ state: phase11ControllerState, container: phase11ControllerContainer, deps: {
    getStorageId: () => 'chat', getTodayTrendStore: async () => phase11ControllerStore,
    getTodayTrendUiScope: async () => phase11ControllerScope,
    getTodayTrendRetentionSettingsState: async () => phase11ControllerRevisions,
    reloadTodayTrendStore: async () => {
        phase11ControllerReloads += 1;
        if (phase11ControllerReloads === 1) phase11ControllerRevisions = phase11ConflictRevisions;
        return phase11ControllerStore;
    },
    saveTodayTrendRetentionSettings: values => phase11RetentionSave(values),
    getTodayTrendGenerationState: () => ({ phase: 'idle' }), subscribeTodayTrendGeneration: () => () => {},
    getTodayTrendCurrentFloor: () => 33, commitTodayTrendScope: async () => phase11ControllerStore,
} });
await phase11Controller.render();
const phase11OpenSettingsButton = { disabled: false, dataset: { action: 'today-trend-open-settings' }, closest: () => phase11OpenSettingsButton };
phase11ControllerListeners.find(item => item.type === 'click' && item.capture)?.listener({ target: phase11OpenSettingsButton });
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(phase11ControllerContainer.innerHTML, /data-today-trend-form="retention-settings"/, 'controller 必须从真实设置入口打开 retention 表单');
const phase11OriginalFormData = globalThis.FormData;
globalThis.FormData = class { constructor(form) { this.values = form.values; } get(name) { return this.values.get(name) ?? null; } getAll() { return []; } };
const phase11RetentionForm = { dataset: { todayTrendForm: 'retention-settings' }, matches: selector => selector === 'form[data-today-trend-form]', values: new Map([
    ['archivedDetailLatestEventCount', '7'], ['archivedDetailRetentionFloors', '44'],
    ['expectedScopeRevision', String(phase11ControllerRevisions.scopeRevision)], ['expectedSettingsRevision', String(phase11ControllerRevisions.settingsRevision)],
]) };
for (const listener of phase11ControllerListeners.filter(item => item.type === 'submit')) listener.listener({ target: phase11RetentionForm, preventDefault() {} });
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(phase11ControllerReloads, 1, 'retention CAS 冲突必须强制 reload committed 值且不得自动重试写入');
assert.match(phase11ControllerContainer.innerHTML, /<code>TT_SETTINGS_REVISION_CONFLICT<\/code>/, 'controller report 必须保留 cause.code');
assert.match(phase11ControllerContainer.innerHTML, /name="archivedDetailLatestEventCount"[^>]*value="7"/,
    'retention CAS 冲突后必须保留用户提交的 N，不得被 reload 的 committed 值覆盖');
assert.match(phase11ControllerContainer.innerHTML, /name="archivedDetailRetentionFloors"[^>]*value="44"/,
    'retention CAS 冲突后必须保留用户提交的 L，不得被 reload 的 committed 值覆盖');
assert.match(phase11ControllerContainer.innerHTML, new RegExp(`name="expectedScopeRevision" value="${phase11ConflictRevisions.scopeRevision}"`),
    'retention CAS 冲突 reload 后必须刷新 expectedScopeRevision');
assert.match(phase11ControllerContainer.innerHTML, new RegExp(`name="expectedSettingsRevision" value="${phase11ConflictRevisions.settingsRevision}"`),
    'retention CAS 冲突 reload 后必须刷新 expectedSettingsRevision');
assert.deepEqual(phase11FocusLog, ['conflict'], 'retention CAS 冲突后焦点必须回到可见冲突提示');
assert.doesNotMatch(phase11ControllerContainer.innerHTML, /<script>/, 'controller 错误 HTML 必须转义 message');
const phase11CopyButton = { disabled: false, dataset: { action: 'today-trend-copy-diagnostic-code', code: 'TT_SETTINGS_REVISION_CONFLICT' }, closest: () => phase11CopyButton };
phase11ControllerListeners.find(item => item.type === 'click' && item.capture)?.listener({ target: phase11CopyButton });
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(phase11ControllerContainer.innerHTML, /复制失败|诊断码已复制/, 'Clipboard 不可用或失败时必须保留错误并显示非阻断反馈');
phase11RetentionSave = async () => { throw Object.assign(new Error('N 必须是十进制整数字符串'), { code: 'TT_RETENTION_SETTINGS_INVALID' }); };
phase11RetentionForm.values.set('archivedDetailLatestEventCount', '2.5');
for (const listener of phase11ControllerListeners.filter(item => item.type === 'submit')) listener.listener({ target: phase11RetentionForm, preventDefault() {} });
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(phase11ControllerReloads, 1, '非法 retention 输入不得触发 committed store reload');
assert.match(phase11ControllerContainer.innerHTML, /<code>TT_RETENTION_SETTINGS_INVALID<\/code>/, '非法 retention 输入必须显示稳定诊断码');
assert.match(phase11ControllerContainer.innerHTML, /name="archivedDetailLatestEventCount"[^>]*value="2\.5"/,
    '非冲突保存失败必须保持用户提交的 retention 输入，不得回退 committed 值');
assert.deepEqual(phase11FocusLog, ['conflict', 'invalid'], '非法 retention 输入后焦点必须回到首个非法字段');
let resolvePhase11LateSave;
phase11RetentionSave = async () => new Promise(resolve => { resolvePhase11LateSave = resolve; });
phase11RetentionForm.values.set('archivedDetailLatestEventCount', '2');
for (const listener of phase11ControllerListeners.filter(item => item.type === 'submit')) listener.listener({ target: phase11RetentionForm, preventDefault() {} });
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(phase11ControllerContainer.innerHTML,
    /data-today-trend-form="retention-settings"[\s\S]*button type="submit" disabled aria-busy="true">正在保存<\/button>/,
    'retention 保存期间必须禁用提交按钮并暴露稳定 loading 状态');
const phase11BeforeDestroyHtml = phase11ControllerContainer.innerHTML;
phase11Controller.destroy();
resolvePhase11LateSave?.({ scope: phase11ControllerScope, revisions: phase11ControllerRevisions });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(phase11ControllerContainer.innerHTML, phase11BeforeDestroyHtml, 'controller destroy 后 retention in-flight 回调不得写 DOM');
globalThis.FormData = phase11OriginalFormData;

// === 动态事件追踪容量契约：normal 与 history 分别注入 ===
const capacityScope = {
    world: { items: [] },
    reputation: { circles: [] },
    factions: [],
    dynamics: {
        active: [
            { id: 'cap-a', type: 'normal', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
            { id: 'cap-b', type: 'incident', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
            { id: 'cap-c', type: 'rumor', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
            { id: 'cap-d', type: 'underground', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
        ],
        archived: [],
    },
    dynamicsSettings: {
        trackingLimit: 3,
        autoComplete: false,
        archiveCompleted: false,
        incident: { enabled: false },
    },
};
const capacityPreset = {
    moduleRules: { world: '', reputation: '', faction: '', dynamics: '' },
    moduleSchemas: { worldItems: '', reputationCircles: '', factionGuidance: '' },
    dynamicsRules: { general: '', incident: '', rumor: '', underground: '' },
};
const capacityContext = {
    characterName: '容量测试角色',
    storageId: 'capacity-test',
    user: { name: '', description: '' },
    character: { description: '', personality: '', scenario: '', firstMessage: '', exampleMessages: [] },
    source: { includeExistingChat: true, userRequirements: '' },
    worldBookText: '',
    mainChatText: '',
    latestChatText: '',
};
const normalCapacityPrompt = buildCanonicalTodayTrendGenerationEnvelope({
    context: capacityContext, preset: capacityPreset, scope: capacityScope, assistantCount: 0,
});
assert.match(normalCapacityPrompt.systemPrompt, /动态事件追踪容量：active=4\/3/, '普通路径必须按 scope.dynamics.active 真实计数动态投影 active/trackingLimit');
assert.match(normalCapacityPrompt.systemPrompt, /剩余 0/, '普通路径必须投影 remaining=0');
assert.match(normalCapacityPrompt.systemPrompt, /normal=1 incident=1 rumor=1 underground=1/, '普通路径必须按四类共享 active 动态统计');
assert.match(normalCapacityPrompt.systemPrompt, /已满/, '普通路径在 active>limit 时必须进入已满分支');
assert.match(normalCapacityPrompt.systemPrompt, /明确事实支持的真实终局/, '普通路径已满必须要求本轮出现明确事实支持的真实终局');
assert.match(normalCapacityPrompt.systemPrompt, /不得为了腾位改 type/, '普通路径已满必须禁止为了腾位改 type');
assert.match(normalCapacityPrompt.systemPrompt, /地下线 absorbed/, '普通路径必须保留地下线 absorbed 承接');
assert.doesNotMatch(normalCapacityPrompt.systemPrompt, /自动删除/, '普通路径不得包含自动删除事件');
assert.doesNotMatch(normalCapacityPrompt.systemPrompt, /自动归档/, '普通路径不得包含自动归档事件');
const historyCapacityPrompt = buildCanonicalTodayTrendGenerationEnvelope({
    context: capacityContext, preset: capacityPreset, scope: capacityScope, assistantCount: 0,
    historyBatch: [{ role: 'user', content: '测试消息' }],
});
assert.match(historyCapacityPrompt.systemPrompt, /动态事件追踪容量：active=4\/3/, '历史批路径必须按 scope.dynamics.active 真实计数动态投影 active/trackingLimit');
assert.match(historyCapacityPrompt.systemPrompt, /剩余 0/, '历史批路径必须投影 remaining=0');
assert.match(historyCapacityPrompt.systemPrompt, /normal=1 incident=1 rumor=1 underground=1/, '历史批路径必须按四类共享 active 动态统计');
assert.match(historyCapacityPrompt.systemPrompt, /已满/, '历史批路径在 active>limit 时必须进入已满分支');
assert.match(historyCapacityPrompt.systemPrompt, /appendStages/, '历史批路径未满必须以 appendStages 表达追加，禁止切碎');
assert.match(historyCapacityPrompt.systemPrompt, /本批 create 不得在本批被 archive/, '历史批路径已满必须禁止 archive 引用本批 create');
assert.match(historyCapacityPrompt.systemPrompt, /history_batch_data 明确支持真实终局/, '历史批路径已满必须要求 history_batch_data 支持真实终局');
assert.match(historyCapacityPrompt.systemPrompt, /本批 create 必须为 \[\]/, '历史批路径已满条件不满足时 create 必须为 []');
assert.doesNotMatch(historyCapacityPrompt.systemPrompt, /自动删除/, '历史批路径不得包含自动删除事件');
assert.doesNotMatch(historyCapacityPrompt.systemPrompt, /自动归档/, '历史批路径不得包含自动归档事件');
assert.match(historyCapacityPrompt.systemPrompt, /当前世界态势 0\/24 项/, '世界 S6 硬 24 项容量参考必须保留');
assert.match(historyCapacityPrompt.systemPrompt, /当前未满 24 项，允许基于本批明确事实在容量内新增 ID，不要求凑满/, '世界 S6 未满 24 项分支文案必须保留');
// === 动态事件追踪容量契约：未满分支（active<trackingLimit）独立因果新建 + 同主题追加/关联 ===
const notFullCapacityScope = {
    world: { items: [] },
    reputation: { circles: [] },
    factions: [],
    dynamics: {
        active: [
            { id: 'nf-a', type: 'normal', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
            { id: 'nf-b', type: 'incident', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
            { id: 'nf-c', type: 'rumor', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
            { id: 'nf-d', type: 'underground', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
        ],
        archived: [],
    },
    dynamicsSettings: {
        trackingLimit: 5,
        autoComplete: false,
        archiveCompleted: false,
        incident: { enabled: false },
    },
};
const notFullNormalPrompt = buildCanonicalTodayTrendGenerationEnvelope({
    context: capacityContext, preset: capacityPreset, scope: notFullCapacityScope, assistantCount: 0,
});
assert.match(notFullNormalPrompt.systemPrompt, /动态事件追踪容量：active=4\/5/, '未满分支普通路径必须按真实计数动态投影 active/trackingLimit');
assert.match(notFullNormalPrompt.systemPrompt, /剩余 1/, '未满分支普通路径必须投影 remaining=1');
assert.match(notFullNormalPrompt.systemPrompt, /normal=1 incident=1 rumor=1 underground=1/, '未满分支普通路径必须按四类共享 active 动态统计');
assert.match(notFullNormalPrompt.systemPrompt, /未满/, '未满分支普通路径必须进入未满分支');
assert.match(notFullNormalPrompt.systemPrompt, /只按实际独立因果新建事件/, '未满分支普通路径新建必须仅限独立因果');
assert.match(notFullNormalPrompt.systemPrompt, /同主题、同一因果链或同一进程必须保持既有 ID 并在原事件上追加真实阶段或相关关联/, '未满分支普通路径同主题必须保持既有 ID 并追加真实阶段或相关关联');
assert.doesNotMatch(notFullNormalPrompt.systemPrompt, /已满/, '未满分支普通路径不得进入已满分支');
assert.doesNotMatch(notFullNormalPrompt.systemPrompt, /自动删除|自动归档/, '未满分支普通路径不得包含自动删除或自动归档');
const notFullHistoryPrompt = buildCanonicalTodayTrendGenerationEnvelope({
    context: capacityContext, preset: capacityPreset, scope: notFullCapacityScope, assistantCount: 0,
    historyBatch: [{ role: 'user', content: '测试消息' }],
});
assert.match(notFullHistoryPrompt.systemPrompt, /动态事件追踪容量：active=4\/5/, '未满分支历史批路径必须按真实计数动态投影 active/trackingLimit');
assert.match(notFullHistoryPrompt.systemPrompt, /剩余 1/, '未满分支历史批路径必须投影 remaining=1');
assert.match(notFullHistoryPrompt.systemPrompt, /normal=1 incident=1 rumor=1 underground=1/, '未满分支历史批路径必须按四类共享 active 动态统计');
assert.match(notFullHistoryPrompt.systemPrompt, /未满/, '未满分支历史批路径必须进入未满分支');
assert.match(notFullHistoryPrompt.systemPrompt, /create 仅在确有全新独立因果时新建事件/, '未满分支历史批路径新建必须仅限独立因果');
assert.match(notFullHistoryPrompt.systemPrompt, /同主题或同一因果链必须保持既有 ID 并使用 appendStages 追加真实阶段/, '未满分支历史批路径同主题必须通过 appendStages 追加既有事件');
assert.match(notFullHistoryPrompt.systemPrompt, /appendStages\.eventId 只能指向既有 active 或本批 create 的事件/, '未满分支历史批路径 appendStages.eventId 必须指向既有 active 或本批 create');
assert.doesNotMatch(notFullHistoryPrompt.systemPrompt, /已满/, '未满分支历史批路径不得进入已满分支');
assert.doesNotMatch(notFullHistoryPrompt.systemPrompt, /本批 create 不得在本批被 archive/, '未满分支历史批路径不得套用已满硬约束');
assert.doesNotMatch(notFullHistoryPrompt.systemPrompt, /自动删除|自动归档/, '未满分支历史批路径不得包含自动删除或自动归档');
// === 动态事件追踪容量契约：trackingLimit 非法/缺失 → 禁止 create，禁止字面量 24 回退 ===
const makeInvalidLimitScope = (mutator) => {
    const clone = {
        world: { items: [] },
        reputation: { circles: [] },
        factions: [],
        dynamics: {
            active: [
                { id: 'inv-a', type: 'normal', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
                { id: 'inv-b', type: 'incident', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
                { id: 'inv-c', type: 'rumor', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
                { id: 'inv-d', type: 'underground', lifecycle: 'active', outcome: null, finalResult: null, stages: [], latestStage: '' },
            ],
            archived: [],
        },
        dynamicsSettings: {
            autoComplete: false,
            archiveCompleted: false,
            incident: { enabled: false },
        },
    };
    if (mutator) mutator(clone);
    return clone;
};
const invalidLimitCases = [
    { name: '缺失', scope: makeInvalidLimitScope() },
    { name: '0', scope: makeInvalidLimitScope((s) => { s.dynamicsSettings.trackingLimit = 0; }) },
    { name: '负数', scope: makeInvalidLimitScope((s) => { s.dynamicsSettings.trackingLimit = -1; }) },
    { name: '非整数', scope: makeInvalidLimitScope((s) => { s.dynamicsSettings.trackingLimit = 5.5; }) },
    { name: '字符串', scope: makeInvalidLimitScope((s) => { s.dynamicsSettings.trackingLimit = '5'; }) },
];
for (const { name, scope } of invalidLimitCases) {
    const normalPrompt = buildCanonicalTodayTrendGenerationEnvelope({
        context: capacityContext, preset: capacityPreset, scope, assistantCount: 0,
    });
    const historyPrompt = buildCanonicalTodayTrendGenerationEnvelope({
        context: capacityContext, preset: capacityPreset, scope, assistantCount: 0,
        historyBatch: [{ role: 'user', content: '测试消息' }],
    });
    assert.doesNotMatch(normalPrompt.systemPrompt, /动态事件追踪容量[^\n]*\/24/, `trackingLimit=${name} 普通路径容量行禁止出现 /24 字面量回退`);
    assert.doesNotMatch(historyPrompt.systemPrompt, /动态事件追踪容量[^\n]*\/24/, `trackingLimit=${name} 历史批路径容量行禁止出现 /24 字面量回退`);
    assert.match(normalPrompt.systemPrompt, /trackingLimit 设置无效或缺失/, `trackingLimit=${name} 普通路径必须显式声明设置无效`);
    assert.match(historyPrompt.systemPrompt, /trackingLimit 设置无效或缺失/, `trackingLimit=${name} 历史批路径必须显式声明设置无效`);
    assert.match(normalPrompt.systemPrompt, /本轮禁止 create 新事件/, `trackingLimit=${name} 普通路径必须本轮禁止 create`);
    assert.match(historyPrompt.systemPrompt, /本批 create 必须为 \[\]/, `trackingLimit=${name} 历史批路径本批 create 必须为 []`);
}
console.log('Today trend contracts verified.');
