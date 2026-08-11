import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
import { createTodayTrendCommitter } from '../src/today-trend-commit.js';
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
import { createTodayTrendScheduler as createTodayTrendSchedulerBase } from '../src/today-trend-scheduler.js';
import { createPhoneHostEventController } from '../src/phone-host-events.js';
import { renderTodayTrendInjection } from '../src/today-trend-injection.js';
import { renderTodayTrendApp } from '../src/today-trend-view.js';
import { renderTodayTrendWorldView } from '../src/today-trend-world-view.js';
import { renderTodayTrendReputationView } from '../src/today-trend-reputation-view.js';
import { renderTodayTrendFactionView } from '../src/today-trend-faction-view.js';
import { renderTodayTrendDynamicsView } from '../src/today-trend-dynamics-view.js';
import { renderTodayTrendSettingsView } from '../src/today-trend-settings-view.js';
import { createTodayTrendActionDispatcher } from '../src/today-trend-actions.js';
import { trendActionMenu, trendInlineActions, trendRuleEditor } from '../src/today-trend-ui.js';

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

assert.equal(TODAY_TREND_VERSION, 1);
for (const contract of [
    installTodayTrend, normalizeTodayTrendStore, createTodayTrendStorage, createTodayTrendCommitter,
    gatherTodayTrendContext, buildTodayTrendInitializationEnvelope, buildTodayTrendGenerationEnvelope,
    createTodayTrendGenerationController, createTodayTrendScheduler, renderTodayTrendInjection,
    renderTodayTrendApp, renderTodayTrendWorldView, renderTodayTrendReputationView,
    renderTodayTrendFactionView, renderTodayTrendDynamicsView, renderTodayTrendSettingsView,
    createTodayTrendActionDispatcher, installTodayTrendPhoneUi, renderPhoneDesktop,
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
const todayTrendRuntimeText = (await Promise.all([
    '../src/today-trend-ui.js',
    '../src/today-trend-world-view.js',
    '../src/today-trend-reputation-view.js',
    '../src/today-trend-faction-view.js',
    '../src/today-trend-dynamics-view.js',
    '../manifest.json',
    '../index.js',
].map(path => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
for (const variable of ['--pm-today-trend-report-rule']) {
    assert.match(todayTrendStyle, new RegExp(`${variable}:`), `今日风向重排必须声明 ${variable} 视觉变量`);
}
assert.doesNotMatch(todayTrendStyle, /--pm-today-trend-(?:node-size|display-size)(?::|\))/, '世界态势新版不得保留已被局部 token 取代的通用尺寸变量或消费者');
assert.doesNotMatch(todayTrendStyle, /assets\/today-trend\/(?:world|reputation|faction|dynamics)\/(?:top|bottom|top-glow|starlight[^/]*)\.svg/, '今日风向不得继续引用头尾或星光 SVG');
assert.doesNotMatch(todayTrendStyle, /assets\/today-trend\/world\/middle-repeat\.svg|pm-today-trend-world-grid/, '世界态势卡片化后不得继续消费重复网格背景');
assert.doesNotMatch(todayTrendRuntimeText, /assets\/today-trend\/(?:world|dynamics)\/[^"'\s)]+\.svg|pm-today-trend-world-(?:grid|brief-tail)/, '源码、清单与构建产物不得继续引用已删除的世界态势或事件追踪装饰资源');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:world|reputation|factions|dynamics)::(?:before|after)[^{]*\{[^}]*(?:background(?:-image)?|content|-webkit-mask(?:-image)?|mask(?:-image)?)[^}]*url\(/, '今日风向模块根节点不得通过伪元素恢复图片装饰');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:world|faction|reputation|dynamics)-(?:head|foot)-art/, '今日风向头尾装饰 SVG 样式必须清理');




const compactTodayTrendMediaStart = todayTrendStyle.lastIndexOf('@media(max-width:320px)');
const compactTodayTrendMedia = todayTrendStyle.slice(compactTodayTrendMediaStart, todayTrendStyle.indexOf('\n', compactTodayTrendMediaStart));
assert.match(compactTodayTrendMedia, /pm-today-trend-event-body>header\{flex-wrap:wrap/, '事件追踪窄屏标题与操作区必须允许分行');
assert.match(todayTrendStyle, /pm-today-trend-event-badge,\.pm-today-trend-event-pill\{[^}]*font-size:var\(--pm-font-size-micro\)/, '事件追踪徽章必须使用超小字号');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-event-card header span/, '事件追踪不得用宽泛 header span 规则覆盖徽章字号');
assert.match(todayTrendStyle, /pm-today-trend-icon-button\[data-action\^="today-trend-refresh"\][\s\S]*?width:var\(--pm-size-control-compact\)[\s\S]*?min-height:var\(--pm-size-control-compact\)/, '生成与刷新图标按钮必须保留 36px 紧凑触控区');
assert.match(todayTrendStyle, /\.pm-today-trend-inline-action\{width:var\(--pm-size-control-compact\);min-height:var\(--pm-size-control-compact\)/, '个人风评行内编辑按钮必须保留 36px 紧凑触控区');
assert.match(todayTrendStyle, /\.pm-today-trend-head-tools\{[^}]*min-width:max-content[^}]*flex:0 0 auto[^}]*flex-direction:column[^}]*align-items:flex-end[^}]*gap:var\(--pm-space-0-5\)[^}]*translateY/, '标题工具区必须保持纵向关系，并让三点按钮与楼层更紧密地轻微上移');
assert.match(todayTrendStyle, /\.pm-today-trend-floor\{[^}]*min-width:max-content[^}]*flex:0 0 auto/, '#楼层仪表必须按完整内容保留宽度，不能截断多位楼层');
assert.match(todayTrendStyle, /\.pm-today-trend-floor-value\{[^}]*color:var\(--pm-color-text-secondary\)/, '楼层数值必须使用界面稍深的次级灰色而非纯黑');
assert.match(todayTrendStyle, /\.pm-today-trend-floor-cancel\{[^}]*cursor:pointer/, '同步状态必须提供明确可点击的终止控件');
assert.match(todayTrendStyle, /\.pm-today-trend-floor-status\{[^}]*font-size:var\(--pm-font-size-micro\)/, '同步状态文字必须与待同步和已同步使用相同的超小字号');
assert.doesNotMatch(todayTrendStyle, /\.pm-today-trend-floor-cancel\{[^}]*font:inherit/, '同步终止按钮不得用 font shorthand 覆盖状态文字字号');
assert.match(todayTrendStyle, /\.pm-today-trend-floor\[data-state="failed"\] \.pm-today-trend-floor-status\{[^}]*color:var\(--pm-color-danger\)/, '同步失败状态必须使用失败反馈色');
assert.match(todayTrendStyle, /\.pm-today-trend-floor-reading\{[^}]*white-space:nowrap/, '#号与楼层数值必须保持单行完整显示');
assert.match(todayTrendRuntimeText, /pm-today-trend-head-tools">\$\{menu\}\$\{asideHtml\}/, '模块头必须先渲染三点菜单，再在其下方渲染楼层');
assert.match(todayTrendStyle, /\.pm-today-trend-dynamics\{gap:var\(--pm-space-1\);?\}/, '事件追踪标题、标签页与内容必须使用收紧后的统一垂直间距');
assert.match(todayTrendStyle, /\.pm-today-trend-event-list\{[^}]*padding:var\(--pm-space-0-5\) var\(--pm-space-0\) var\(--pm-space-1\)/, '事件追踪列表顶部留白必须同步收紧');
assert.match(compactTodayTrendMedia, /pm-today-trend-module-head\{gap:var\(--pm-space-1\)/, '320px 窄屏必须缩小标题与工具区间距并保留按钮命中区');
assert.match(todayTrendStyle, /\.pm-today-trend-menu-action,\.pm-today-trend-menu-close\{flex-basis:var\(--pm-size-control-compact\);width:var\(--pm-size-control-compact\);min-height:var\(--pm-size-control-compact\)/, '320px 菜单按钮不得缩回 28px 命中区');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:icon-button\[data-action\^="today-trend-(?:refresh|generate)"\]|reputation-copy \.pm-today-trend-inline-action)\{width:28px/, '今日风向真实操作按钮不得使用 28px 命中区');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-content\.is-(?:reputation|faction|dynamics)::/, '旧内容容器背景伪元素必须清理');
for (const selector of ['pm-today-trend-world-hero,\\.pm-today-trend-world-brief', 'pm-today-trend-reputation-entry', 'pm-today-trend-faction-card', 'pm-today-trend-event-card']) {
    assert.match(todayTrendStyle, new RegExp(`${selector}\\{[^}]*padding:var\\(--pm-space-3\\)[^}]*border:0[^}]*border-radius:var\\(--pm-radius-card\\)[^}]*background:transparent[^}]*box-shadow:none`), `${selector} 必须消费统一的无底无框卡片外壳`);
}
assert.match(todayTrendStyle, /pm-today-trend-faction-card>\.pm-today-trend-faction-node\{[^}]*border-radius:var\(--pm-radius-circle\)[^}]*transform:none/, '势力节点必须统一为圆形卡片节点');
assert.match(todayTrendStyle, /pm-today-trend-faction-meter span::after\{[^}]*border-radius:var\(--pm-radius-circle\)/, '势力评级必须统一为圆形游标');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:faction-card>\.pm-today-trend-faction-node|faction-meter span(?::after|\.is-active::after))\{[^}]*rotate\(45deg\)/, '势力图谱不得恢复菱形节点或游标');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-world-brief\.is-(?:left|right)|pm-today-trend-faction-tree(?:\[[^}]+)?\{[^}]*border-left/, '卡片化源码不得残留世界左右轨道选择器或势力树左轨声明');
assert.match(todayTrendStyle, /pm-today-trend-event-card\{[^}]*border:0[^}]*background:transparent[^}]*box-shadow:none/, '事件追踪卡片必须隐藏底色、描边和阴影');
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

const fixture = () => ({
    version: 1,
    presets: {
        preset: {
            id: 'preset', name: '综艺世界', version: 1, revision: 1, createdAt: 1, updatedAt: 2,
            source: { worldBookNames: ['厨房'], includeExistingChat: true, userRequirements: '保持节目规则' },
            moduleRules: { world: '世界', reputation: '风评', faction: '势力', dynamics: '动态' },
            moduleSchemas: { worldItems: '项目', reputationCircles: '圈层', factionGuidance: '指引' },
            dynamicsRules: { general: '总规则', incident: '突发', rumor: '流言', underground: '地下' },
        },
    },
    scopes: {
        chat: {
            storageId: 'chat', characterId: 'character', characterName: '小明', presetId: 'preset',
            operation: { enabled: true, mode: 'auto', intervalFloors: 3, lastSuccessfulAssistantCount: 7, lastSuccessfulRunAt: 9 },
            injection: { enabled: false },
            world: { items: [{ id: 'world', name: '节目风向', summary: '晚餐服务临近' }] },
            dynamicsSettings: createDefaultTodayTrendDynamicsSettings(),
            reputation: { circles: [{ id: 'judge', name: '主厨评审', scope: '节目评审', status: 'neutral', evaluation: '仍在观察' }] },
            factions: [
                { id: 'red', name: '红队', summary: '参赛队伍', parentId: null, relatedFactionIds: [], details: [{ label: '队长', value: '阿红' }], relation: { status: 'like', evaluation: '认可配合能力' } },
                { id: 'station', name: '节目组', summary: '制作单位', parentId: 'red', relatedFactionIds: [], details: [], relation: { status: 'neutral', evaluation: '正在观察' } },
            ],
            dynamics: {
                active: [{ id: 'service', type: 'normal', lifecycle: 'active', title: '晚餐服务', stageLabel: '准备中', origin: '开餐临近', participants: ['小明', '红队'], stages: ['分配岗位', '检查食材'], latestStage: '检查食材', outcome: null, finalResult: null, relatedEventIds: [], createdAt: 1, updatedAt: 2 }],
                archived: [{ id: 'rumor', type: 'rumor', lifecycle: 'archived', title: '换队传闻', stageLabel: '已证实', origin: '后台流言', participants: ['小明'], stages: ['开始流传'], latestStage: '开始流传', outcome: 'confirmed', finalResult: '传闻属实', relatedEventIds: ['service'], createdAt: 1, updatedAt: 3 }],
            },
        },
    },
});
const assertCode = (mutate, code) => assert.throws(() => normalizeTodayTrendStore(mutate()), error => error?.code === code);
const valid = normalizeTodayTrendStore(fixture());
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
const phoneController = createTodayTrendPhoneController({ state: controllerState, container: controllerContainer, deps: {
    getStorageId: () => controllerStorageId, getTodayTrendStore: async () => controllerStore,
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
    commitTodayTrendScope: async () => valid, cancelTodayTrendInitialization: reason => { controllerCancelReason = reason; },
} });
assert.equal(await phoneController.render(), true, '控制器必须渲染当前聊天的今日风向页面');
assert.match(controllerContainer.innerHTML, /id="pm-today-trend-app"/, '控制器必须渲染今日风向页面壳');
assert.match(controllerContainer.innerHTML, /data-today-trend-floor="3402"[\s\S]*pm-today-trend-floor-value">#3402<\/strong>/, '控制器必须把宿主当前多位楼层完整传给视图');
assert.equal(typeof generationListener, 'function', '控制器创建时必须订阅今日风向生成状态');
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
assert.deepEqual(controllerListeners.map(item => controllerListenerKey(item.type, item.capture)).sort(), ['click:bubble', 'click:capture', 'keydown:bubble', 'submit:bubble', 'submit:bubble'], '控制器必须恰好注册并区分自身与动作分发器的 click、submit 与 keydown 代理事件');
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
assert.match(failedInitializationHtml, /保留淘汰规则/, '初始化失败后必须保留追加要求');
assert.match(failedInitializationHtml, /class="pm-today-trend-init-feedback pm-today-trend-error" role="alert">初始化失败<\/p>/, '初始化错误必须保留 alert 语义并位于反馈区');
const appHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), generation: { phase: 'idle' } });
for (const label of ['世界态势', '个人风评', '势力图谱', '事件追踪']) assert.match(appHtml, new RegExp(label), `主页面必须装配${label}`);
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
    generation: { phase: 'failed', task: { kind: 'auto', storageId: 'chat', floor: 12, target: null }, lastError: '\"失败\" <script> & more' }, currentFloor: 12 });
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
for (const name of ['presetId', 'mode', 'intervalFloors', 'injectionEnabled']) assert.match(appSettingsHtml, new RegExp(`name="${name}"`), `APP 总设置必须提供 ${name}`);
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
assert.match(ruleEditorHtml, />返回<\/button><button type="submit">保存提示词<\/button>/, '规则编辑必须使用中文操作文案');
assert.doesNotMatch(ruleEditorHtml, /Prompt|PROMPT/, '规则编辑可见文案不得残留英文 Prompt');
const worldHtml = renderTodayTrendWorldView({ scope: valid.scopes.chat, generationAvailable: true, menuOpenId: 'world-module' });
const worldPanelsScope = { ...valid.scopes.chat, world: { items: [...valid.scopes.chat.world.items, { id: 'world-brief', name: '后勤消息', summary: '补给已抵达' }, { id: 'world-terminal', name: '航线警报', summary: '航线出现扰动' }] } };
const worldPanelsHtml = renderTodayTrendWorldView({ scope: worldPanelsScope });
const worldPanelsMenuHtml = renderTodayTrendWorldView({ scope: worldPanelsScope, generationAvailable: true, menuOpenId: 'world-module' });
assert.match(worldHtml, /编辑世界态势提示词/, '世界态势入口必须使用中文提示词文案');
assert.doesNotMatch(worldHtml, /编辑世界态势 Prompt/, '世界态势入口不得残留英文 Prompt');
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
assert.match(worldPanelsHtml, /pm-today-trend-world-signal-marker[^>]*aria-hidden="true"><i><\/i><\/span>/, '世界态势卡片必须保留圆形主题节点');
assert.doesNotMatch(worldPanelsHtml, /pm-today-trend-world-brief-tail|\bis-(?:left|right)\b/, '世界态势卡片不得保留尾线或左右轨道布局类');
assert.match(worldHtml, /pm-today-trend-meter[\s\S]*?SIGNALS[\s\S]*?BRIEFS/, '世界态势 meta 必须用英文装饰标签映射真实项目与摘要数量');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-world-(?:signals::before|hero\.has-signals::after|brief\.is-right::after)/, '世界态势不得恢复连续轨道线');
assert.match(todayTrendStyle, /pm-today-trend-world \.pm-today-trend-meter\{margin-top:var\(--pm-today-trend-world-meta-offset\)/, '世界态势 meta 与标题的间距必须由原型映射 token 控制');
assert.match(todayTrendStyle, /pm-today-trend-world\{flex:0 0 auto;gap:var\(--pm-space-2\);padding:var\(--pm-space-3\) var\(--pm-space-4\) var\(--pm-space-5\)/, '世界态势必须使用与其他模块一致的内容内边距');
assert.match(todayTrendStyle, /pm-today-trend-content\.is-world\{[^}]*padding:var\(--pm-space-0\) var\(--pm-space-0\) var\(--pm-space-px-36\)/, '世界态势必须保留底部导航安全区');
assert.match(todayTrendStyle, /--pm-today-trend-report-title-size:calc\(var\(--pm-font-size-title\) \+ var\(--pm-space-2\)\)/, '其他三个模块的大标题必须使用收紧后的统一字号');
assert.match(todayTrendStyle, /--pm-today-trend-world-title-size:calc\(var\(--pm-font-size-title\) \+ var\(--pm-space-2\)\)/, '世界态势模块标题必须与其他三个模块使用同一字号');
assert.match(todayTrendStyle, /--pm-today-trend-world-hero-title-size:calc\(var\(--pm-font-size-title\) \+ var\(--pm-space-1\)\)/, '世界态势内容主标题必须进一步收紧字号');
assert.match(todayTrendStyle, /pm-today-trend-(?:reputation|factions|dynamics)>\.pm-today-trend-module-head h2[^}]*font-size:var\(--pm-today-trend-report-title-size\)/, '其他三个模块标题选择器必须消费统一字号 token');
assert.match(todayTrendStyle, /pm-today-trend-world>\.pm-today-trend-module-head h2[^}]*font-size:var\(--pm-today-trend-world-title-size\)/, '世界态势标题选择器必须消费统一字号 token');
assert.match(todayTrendStyle, /pm-today-trend-world>\.pm-today-trend-module-head\{[^}]*margin:var\(--pm-space-0\)[^}]*padding-bottom:var\(--pm-space-3\)/, '世界态势模块头必须与其他模块使用一致节奏');
assert.match(todayTrendStyle, /--pm-today-trend-world-brief-title-size:var\(--pm-font-size-subtitle\)/, '世界态势次级标题必须使用收紧后的字号');
assert.match(todayTrendStyle, /pm-today-trend-world-signal-marker::after\{display:none/, '世界态势节点不得保留原型以外的横向引线');
assert.match(todayTrendStyle, /pm-today-trend-world-hero b\{[^}]*font-size:var\(--pm-today-trend-world-hero-title-size\)[^}]*font-weight:var\(--pm-font-weight-semibold\)[^}]*line-height:var\(--pm-line-height-display\)/, '世界态势 hero 必须通过专属 token 还原新版原型层级');
assert.match(todayTrendStyle, /pm-today-trend-world-hero,\.pm-today-trend-world-brief\{[^}]*border:0[^}]*border-radius:var\(--pm-radius-card\)[^}]*background:transparent[^}]*box-shadow:none/, '世界态势条目必须使用无底无框卡片外壳');
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
assert.doesNotMatch(worldSettingsHtml, /today-trend-edit-world-rule/, '世界态势设置不得重复提供模块规则动作');
assert.doesNotMatch(worldSettingsHtml, /自然环境|行业环境|灵气环境/, '世界态势设置不得硬编码世界项目类别');
const reputationHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, preset: valid.presets.preset, mode: 'content', generationAvailable: true });
const reputationMenuHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, generationAvailable: true, menuOpenId: 'reputation-module' });
assert.match(reputationMenuHtml, /编辑个人风评提示词/, '个人风评入口必须使用中文提示词文案');
assert.doesNotMatch(reputationMenuHtml, /编辑个人风评 Prompt/, '个人风评入口不得残留英文 Prompt');
const reputationItemMenuHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, generationAvailable: true, menuOpenId: 'circle:judge' });
assert.match(reputationHtml, /主厨评审/, '个人风评页必须渲染世界观圈层名称');
assert.match(reputationHtml, /中立/, '个人风评页必须渲染固定五档状态的中文标签');
assert.match(reputationHtml, /pm-today-trend-reputation-entry/, '个人风评内容页必须使用观察报告条目结构');
assert.match(reputationHtml, /PUBLIC OPINION/, '个人风评内容页必须提供报告识别语');
assert.match(reputationHtml, /pm-today-trend-meter-k">PEOPLE<\/span><span class="pm-today-trend-meter-v">1<\/span>/, '个人风评头部必须展示真实 PEOPLE 统计');
assert.match(reputationHtml, /pm-today-trend-meter-k">GOOD<\/span><span class="pm-today-trend-meter-v">0<\/span>/, '个人风评头部必须展示真实 GOOD 统计');
assert.match(reputationHtml, /pm-today-trend-meter-k">BAD<\/span><span class="pm-today-trend-meter-v">0<\/span>/, '个人风评头部必须展示真实 BAD 统计');
assert.doesNotMatch(reputationHtml, /pm-today-trend-reputation-(?:head-art|file-no)|PRS-240502/, '个人风评不得渲染已废弃的档案装饰或编号');
assert.match(reputationHtml, /pm-today-trend-reputation-mark/, '个人风评条目必须提供图标标记');
assert.match(reputationHtml, /data-status="neutral"/, '个人风评状态必须提供主题化样式钩子');
assert.match(reputationHtml, /主厨评审<\/b><span class="pm-today-trend-status" data-status="neutral">中立<\/span>/, '个人风评状态徽章必须紧贴标题，而非占用评级列');
assert.doesNotMatch(reputationHtml, /pm-today-trend-reputation-orbit/, '个人风评背景不得局限在模块子容器内');
assert.match(reputationMenuHtml, /today-trend-edit-reputation-rule/, '展开个人风评模块操作后必须提供规则编辑动作');
assert.doesNotMatch(reputationHtml, /today-trend-edit-circle/, '个人风评收起模块操作时不得显示单条编辑入口');
assert.match(reputationHtml, /pm-today-trend-reputation-meter" role="radiogroup" aria-label="修改主厨评审的好感度，当前：中立"/, '个人风评必须为每条记录输出可访问的好感度单选组');
assert.equal((reputationHtml.match(/data-action="today-trend-set-circle-status"/g) || []).length, valid.scopes.chat.reputation.circles.length * 5, '个人风评每条记录必须输出五个实时状态按钮');
assert.match(reputationHtml, /data-circle-id="judge" data-status="neutral" aria-checked="true" role="radio"/, '当前好感度按钮必须暴露选中语义');
assert.match(reputationHtml, /data-circle-id="judge" data-status="like" aria-checked="false" role="radio"/, '非当前好感度按钮必须暴露未选中语义');
assert.deepEqual([...reputationHtml.matchAll(/data-circle-id="judge" data-status="([^"]+)"/g)].map(match => match[1]), ['trust', 'like', 'neutral', 'dislike', 'hostile'], '个人风评量表必须从上到下按信任至敌对排列');
for (const label of ['敌对', '厌恶', '中立', '喜爱', '信任']) assert.match(reputationHtml, new RegExp(`aria-label="${label}"`), `个人风评必须以可访问名称提供五档好感度：${label}`);
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
assert.equal((reputationMenuHtml.match(/pm-today-trend-menu-wrap is-open/g) || []).length, 1, '个人风评只允许模块操作菜单展开');
assert.doesNotMatch(reputationItemMenuHtml, /today-trend-edit-circle/, '旧圈层菜单 ID 不得意外展开行内动作');
const reputationEditorHtml = renderTodayTrendReputationView({ scope: valid.scopes.chat, editingCircleId: 'judge' });
assert.match(reputationEditorHtml, /pm-today-trend-reputation-entry is-editing[\s\S]*?data-today-trend-form="circle"/, '个人风评内容区的编辑铅笔必须打开该条目的内联编辑表单');
assert.match(reputationEditorHtml, /data-action="today-trend-cancel-reputation-editor"/, '个人风评内联编辑取消必须停留在内容页');
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
assert.match(todayTrendStyle, /pm-today-trend-reputation\{[^}]*--pm-today-trend-reputation-mark-size/, '个人风评必须在根选择器集中声明局部尺寸 token');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-reputation-(?:head-art|file-no)/, '个人风评不得保留没有 DOM 消费者的档案装饰样式');
assert.match(todayTrendStyle, /pm-today-trend-reputation-mark\{[^}]*border:0[^}]*border-radius:var\(--pm-radius-circle\)[^}]*background:var\(--pm-color-accent\)/, '个人风评图标必须统一为圆形主题节点');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-reputation-mark::(?:before|after)|pm-today-trend-reputation-copy\{[^}]*border-left/, '个人风评不得恢复框角或正文轨道线');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry\{[^}]*border:0[^}]*border-radius:var\(--pm-radius-card\)[^}]*background:transparent[^}]*box-shadow:none/, '个人风评条目必须使用无底无框卡片外壳');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry\{[^}]*display:grid[^}]*grid-template-columns:var\(--pm-today-trend-reputation-mark-size\) minmax\(0,1fr\) var\(--pm-today-trend-reputation-rating-width\)/, '个人风评条目必须保持图标、正文和评级三列流式布局');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button\{[^}]*min-height:var\(--pm-size-control-default\)/, '个人风评五档状态按钮必须保留 44px 主触控高度');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter\{[^}]*row-gap:var\(--pm-space-1\)[^}]*padding:var\(--pm-space-1\) var\(--pm-space-0-5\)/, '个人风评量表必须放宽纵向间隔与容器内边距');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button\{[^}]*min-width:var\(--pm-size-control-default\)[^}]*padding:var\(--pm-space-1\) var\(--pm-space-0-5\)/, '个人风评状态按钮必须放宽横向命中区');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button::before/, '个人风评量表必须提供横向刻度');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button\.is-active::after/, '个人风评量表必须提供当前档圆点与光晕');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button:focus-visible/, '个人风评状态按钮必须提供键盘焦点样式');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button:disabled/, '个人风评状态按钮必须提供禁用样式');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry\.is-editing\{[^}]*display:block/, '个人风评编辑态必须退出三列网格，供编辑器跨列展开');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry\.is-editing>\.pm-today-trend-editor\{[^}]*width:100%/, '个人风评编辑器必须占满编辑态行宽');
assert.doesNotMatch(reputationHtml, /pm-today-trend-reputation-foot-art/, '个人风评内容页不得渲染底部装饰 SVG');
const factionHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, menuOpenId: 'faction-module' });
const factionItemMenuHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, menuOpenId: 'faction:red' });
assert.match(factionHtml, /编辑势力图谱提示词/, '势力图谱入口必须使用中文提示词文案');
assert.doesNotMatch(factionHtml, /编辑势力图谱 Prompt/, '势力图谱入口不得残留英文 Prompt');
assert.match(factionHtml, /红队/, '势力页必须渲染根势力');
assert.match(factionHtml, /节目组/, '势力页必须递归渲染子势力');
assert.match(factionHtml, /队长/, '势力卡片必须直接展示关键资料');
assert.match(factionHtml, /POWER MAP/, '势力内容页必须提供图谱识别语');
assert.match(factionHtml, /pm-today-trend-faction-tree" data-depth="0"/, '势力图谱必须标识根层级');
assert.match(factionHtml, /pm-today-trend-faction-card"[^>]*data-depth="1"/, '势力图谱必须标识子层级');
assert.match(todayTrendStyle, /pm-today-trend-faction-tree\[data-depth\]:not\(\[data-depth="0"\]\)\{[^}]*margin-left:var\(--pm-today-trend-faction-nested-indent\)[^}]*padding-left:var\(--pm-today-trend-faction-nested-indent\)/, '势力子层级必须保留缩进且不依赖左侧大轨道');
assert.match(todayTrendStyle, /pm-today-trend-faction-tree\[data-depth\]:not\(\[data-depth="0"\]\):not\(\[data-depth="1"\]\)\{[^}]*margin-left:var\(--pm-space-0\)[^}]*padding-left:var\(--pm-space-0\)/, '势力深层级必须停止累计缩进以避免窄屏溢出');
assert.match(todayTrendStyle, /pm-today-trend-faction-card\{[^}]*border:0[^}]*border-radius:var\(--pm-radius-card\)[^}]*background:transparent[^}]*box-shadow:none/, '势力条目必须使用无底无框卡片外壳');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-faction-detail\{[^}]*border-left|pm-today-trend-faction-detail-row::before/, '势力详情不得恢复轨道线或菱形连接器');
assert.match(todayTrendStyle, /@media\(max-width:320px\)[\s\S]*?pm-today-trend-faction-card\{[^}]*var\(--pm-today-trend-faction-meter-width\)/, '320px 下势力关系评级列不得被隐藏');
assert.match(todayTrendStyle, /pm-today-trend-faction-meter\{[^}]*row-gap:var\(--pm-space-1\)[^}]*min-height:calc\(var\(--pm-size-control-default\) \* 2\)/, '势力关系量表必须放宽纵向间隔');
assert.match(todayTrendStyle, /pm-today-trend-faction-meter span\{[^}]*min-height:var\(--pm-space-5\)[^}]*padding:var\(--pm-space-0-5\)/, '势力关系档位必须放宽横纵空间');

assert.doesNotMatch(factionHtml, /pm-today-trend-external-list|pm-today-trend-external-relation/, '外部关联不得再单独列成第二份势力清单');
assert.match(factionHtml, /pm-today-trend-faction-node/, '势力图谱必须输出独立节点装饰');
assert.doesNotMatch(factionHtml, /pm-today-trend-faction-constellation/, '势力背景不得局限在模块子容器内');
assert.match(factionHtml, /today-trend-edit-faction-rule/, '势力图谱模块必须提供规则编辑动作');
assert.doesNotMatch(factionHtml, /today-trend-add-faction/, '势力图谱顶级操作不得保留计划外添加势力入口');
assert.match(factionHtml, /today-trend-edit-faction[^>]*data-faction-id="red"/, '展开势力图谱模块操作后必须显示条目编辑入口');
assert.doesNotMatch(factionHtml, /today-trend-refresh-faction/, '势力图谱内容区不得保留单项重新生成入口');
assert.equal((factionHtml.match(/pm-today-trend-menu-wrap is-open/g) || []).length, 1, '势力图谱只允许模块操作菜单展开');
assert.doesNotMatch(factionItemMenuHtml, /pm-today-trend-inline-actions/, '旧势力条目菜单 ID 不得意外展开任何行内动作');
const deepFactionScope = structuredClone(valid.scopes.chat);
deepFactionScope.factions = Array.from({ length: 12 }, (_, index) => ({ id: `deep-${index}`, name: `深层势力${index}`, summary: '链式层级', parentId: index ? `deep-${index - 1}` : null, relatedFactionIds: [], details: [], relation: { status: 'neutral', evaluation: '观察中' } }));
assert.match(renderTodayTrendFactionView({ scope: deepFactionScope }), /data-depth="11"/, '合法深层势力链必须保持可渲染，而非截断数据');
const malformedRelationScope = structuredClone(valid.scopes.chat);
malformedRelationScope.factions[0].relation = [];
assert.match(renderTodayTrendFactionView({ scope: malformedRelationScope }), /data-faction-id="red"[\s\S]*?data-status="neutral"/, '势力视图必须将数组 relation 回退为中立对象');
const busyFactionHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, generationAvailable: true, generationBusy: true, menuOpenId: 'faction-module' });
assert.match(busyFactionHtml, /today-trend-generate-factions"[^>]*disabled aria-busy="true"/, '忙碌时势力模块生成必须禁用并暴露忙碌状态');
assert.match(renderTodayTrendReputationView({ scope: valid.scopes.chat, mode: 'settings', menuOpenId: 'reputation-settings' }), /today-trend-regenerate-circle-schema/, '个人风评设置顶级操作打开后必须提供结构重新生成动作');
const factionEditorHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, mode: 'editor', editingFactionId: 'red' });
assert.match(factionEditorHtml, /name="parentId"/, '势力编辑页必须提供可空父势力选择');
const busyFactionSettingsHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, mode: 'settings', generationAvailable: true, generationBusy: true });
assert.doesNotMatch(busyFactionSettingsHtml, /today-trend-regenerate-faction-rule/, '势力图谱设置不得重复提供模块规则动作');
const busyDynamicsHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, generationBusy: true, menuOpenId: 'dynamics-module' });
const dynamicsItemMenuHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, menuOpenId: 'event:service' });
assert.match(busyDynamicsHtml, /today-trend-advance-all-events[\s\S]*?disabled aria-busy="true"/, '忙碌时动态模块生成必须禁用并暴露忙碌状态');
assert.match(busyDynamicsHtml, /today-trend-edit-dynamics-rule/, '动态模块必须提供规则编辑动作');
assert.doesNotMatch(busyDynamicsHtml, /pm-today-trend-dynamics-(?:head|foot)-art/, '事件追踪不得渲染头尾装饰 SVG');
assert.match(busyDynamicsHtml, /today-trend-open-dynamics-settings/, '动态模块必须保留专属设置动作');
assert.doesNotMatch(busyDynamicsHtml, /today-trend-create-event/, '动态模块顶级操作不得保留计划外创建事件入口');
assert.match(busyDynamicsHtml, /today-trend-edit-event[^>]*data-event-id="service"/, '展开事件追踪模块操作后必须显示条目编辑入口');
assert.doesNotMatch(busyDynamicsHtml, /today-trend-advance-event/, '动态内容区不得保留单项推进入口');
assert.equal((busyDynamicsHtml.match(/pm-today-trend-menu-wrap is-open/g) || []).length, 1, '事件追踪只允许模块操作菜单展开');
assert.doesNotMatch(dynamicsItemMenuHtml, /pm-today-trend-inline-actions/, '旧事件条目菜单 ID 不得意外展开任何行内动作');
assert.match(busyDynamicsHtml, /EVENT TRACKER/, '动态内容页必须提供追踪识别语');
assert.match(busyDynamicsHtml, /pm-today-trend-event-facts/, '动态内容页必须提供结构化事件事实区');
assert.match(busyDynamicsHtml, /pm-today-trend-event-history/, '动态内容页必须提供阶段时间线容器');
assert.match(busyDynamicsHtml, /pm-today-trend-event-marker" aria-hidden="true"/, '事件追踪卡片必须包含左侧节点');
assert.match(busyDynamicsHtml, /pm-today-trend-event-body/, '事件追踪卡片必须将内容与左侧节点分层');
assert.match(busyDynamicsHtml, /role="tablist"[^>]*aria-label="事件追踪状态"/, '事件追踪必须提供可访问的状态 tab 容器');
assert.match(busyDynamicsHtml, /data-action="today-trend-set-dynamics-tab"[^>]*data-tab="active"[^>]*aria-selected="true"/, '事件追踪默认必须选中正在追踪 tab');
assert.match(busyDynamicsHtml, /data-tab="active"[^>]*aria-selected="true"[^>]*aria-controls="pm-today-trend-active-panel"[^>]*tabindex="0"/, '当前事件 tab 必须进入键盘焦点序列');
assert.match(busyDynamicsHtml, /data-tab="archived"[^>]*aria-selected="false"[^>]*aria-controls="pm-today-trend-archived-panel"[^>]*tabindex="-1"/, '非当前事件 tab 必须退出键盘焦点序列');
assert.match(busyDynamicsHtml, /pm-today-trend-active-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="pm-today-trend-active-tab"[^>]*><|pm-today-trend-archived-panel"[^>]*hidden/, '事件 tab 面板必须有可访问关联并对非当前面板使用 hidden');
assert.match(busyDynamicsHtml, /pm-today-trend-event-pill is-live/, '活跃事件必须提供带状态点的 pill');
assert.match(busyDynamicsHtml, /pm-today-trend-stage-tag">最新阶段/, '活跃事件的最后阶段必须标记为最新阶段');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-event-list::before/, '事件追踪列表必须删除左侧大轨道');
assert.match(todayTrendStyle, /pm-today-trend-event-marker\{[^}]*background:var\(--pm-color-accent\)[^}]*color:var\(--pm-color-on-accent\)/, '事件追踪大图标必须使用主题色');
assert.match(todayTrendStyle, /pm-today-trend-event-body>header\{[^}]*display:flex[^}]*justify-content:space-between/, '事件追踪标题与行内操作必须使用独立弹性布局');
assert.match(todayTrendStyle, /pm-today-trend-event-card\{[^}]*grid-template-columns:var\(--pm-today-trend-dynamics-rail\) minmax\(0,1fr\)/, '事件追踪卡片必须使用节点与正文双列网格');
assert.doesNotMatch(busyDynamicsHtml, /pm-today-trend-dynamics-signal|pm-today-trend-dynamics-arc/, '事件背景不得局限在模块子容器内或保留灰色弧线');
assert.doesNotMatch(busyDynamicsHtml, /pm-today-trend-progress|正在生成…/, '目标模块不得保留标题栏之外的重复生成状态');
assert.match(factionEditorHtml, /name="detailLabel"/, '势力编辑页必须提供动态关键资料编辑');
assert.match(factionEditorHtml, /name="status"/, '势力编辑页必须提供固定五档关系选择');
assert.match(factionEditorHtml, /data-action="today-trend-add-detail"/, '势力编辑页必须提供关键资料添加动作');
const maxDetailsScope = structuredClone(valid.scopes.chat);
maxDetailsScope.factions[0].details = Array.from({ length: TODAY_TREND_LIMITS.factionDetails }, (_, index) => ({ label: `资料${index}`, value: `值${index}` }));
assert.match(renderTodayTrendFactionView({ scope: maxDetailsScope, mode: 'editor', editingFactionId: 'red' }), /data-action="today-trend-add-detail" disabled/, '势力资料达到上限时，编辑器必须禁用添加入口');
const detailListeners = {};
const detailList = {
    children: Array.from({ length: TODAY_TREND_LIMITS.factionDetails - 1 }),
    insertAdjacentHTML: () => { detailList.children.push({}); },
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
assertCode(() => { const value = fixture(); value.scopes.chat.factions[0].details = [{ label: '队长', value: '甲' }, { label: '队长', value: '乙' }]; return value; }, 'TT_FACTION_DETAILS');
assertCode(() => { const value = fixture(); value.scopes.chat.factions[1].relatedFactionIds = ['red']; return value; }, 'TT_FACTION_RELATION_OVERLAP');
assertCode(() => { const value = fixture(); value.scopes.chat.operation.enabled = 'true'; return value; }, 'TT_SCOPE');
assertCode(() => { const value = fixture(); value.scopes.chat.injection.enabled = 1; return value; }, 'TT_SCOPE');
assertCode(() => { const value = fixture(); value.presets.preset.source.includeExistingChat = 1; return value; }, 'TT_PRESET');
assertCode(() => { const value = fixture(); value.scopes.chat.dynamics.active[0].relatedEventIds = ['missing']; return value; }, 'TT_EVENT_RELATED');
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
assert.match(dynamicsHtml, /正在追踪/, '动态页必须区分正在追踪事件');
assert.match(dynamicsHtml, /已完结/, '动态页必须区分归档事件');
assert.match(archivedDynamicsHtml, /事件归档/, '归档 tab 必须联动模块标题');
assert.match(archivedDynamicsHtml, /DONE[\s\S]*?TOTAL/, '归档 tab meta 必须由归档和总事件数映射');
assert.match(archivedDynamicsHtml, /data-tab="archived"[^>]*aria-selected="true"/, '归档 tab 必须暴露选中状态');
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
assert.doesNotMatch(renderTodayTrendDynamicsView({ scope: activeRumorScope, editingEventId: 'archive:active-rumor' }), /value="resolved"/, '流言归档 UI 只能提供证实或证伪结果');
assert.doesNotMatch(renderTodayTrendDynamicsView({ scope: valid.scopes.chat, editingEventId: 'archive:service' }), /value="confirmed"|value="debunked"|value="absorbed"/, '普通事件归档 UI 不得暴露流言或承接结果');
assert.match(renderTodayTrendDynamicsView({ scope: undergroundScope, menuOpenId: 'dynamics-module' }), /today-trend-promote-underground/, '动态顶级操作打开后必须提供地下线升级入口');
assert.match(renderTodayTrendDynamicsView({ scope: undergroundScope, editingEventId: 'promote:underground' }), /data-today-trend-form="event-promotion"/, '地下线升级必须提供受控事件表单');
assert.doesNotMatch(dynamicsSettingsHtml, /today-trend-edit-(?:dynamics|incident|rumor|underground)-rule/, '动态设置不得重复提供模块规则入口');



const promotedScope = promoteTodayTrendUnderground(undergroundScope, 'underground', { id: 'incident', title: '后台冲突', stageLabel: '爆发中', origin: '交易曝光', participants: ['小明'], stages: ['工作人员介入'], latestStage: '工作人员介入' });
assert.equal(promotedScope.dynamics.archived.find(event => event.id === 'underground').outcome, 'absorbed', '地下线升级必须归档原事件');
assert.equal(promotedScope.dynamics.active.find(event => event.id === 'incident').type, 'incident', '地下线升级必须新建突发事件，不能改写历史类型');
const injectionScope = { ...valid.scopes.chat, injection: { enabled: true } };
const injection = renderTodayTrendInjection(injectionScope);
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
const primaryStorage = memoryStorage();
let primarySnapshot = null;
const persistentStorage = createTodayTrendStorage({
    idbGet: async () => primarySnapshot,
    idbSet: async (_key, value) => { primarySnapshot = structuredClone(value); return true; },
    storage: primaryStorage,
});
await persistentStorage.save(valid);
assert.deepEqual(await persistentStorage.load(), valid, 'IDB 主存储必须可往返规范数据');
assert.equal(primaryStorage.getItem('ST_SMS_TODAY_TREND_V1_LOCAL_FALLBACK'), null, '主存储成功后必须清理后备快照');
const fallbackStorage = memoryStorage();
const fallbackPersistence = createTodayTrendStorage({
    idbGet: async () => { throw new Error('IDB unavailable'); },
    idbSet: async () => false,
    storage: fallbackStorage,
});
await fallbackPersistence.save(valid);
assert.deepEqual(await fallbackPersistence.load(), valid, 'IDB 不可用时必须从 localStorage 后备数据恢复');

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
assert.match(collectedContext.mainChatText, /晚餐服务/, '启用已有正文时必须保留主线正文');
const initializationPrompts = buildTodayTrendInitializationEnvelope({ context: collectedContext });
assert.match(initializationPrompts.systemPrompt, /顶层只能有 preset 和 scope/, '初始化提示词必须锁定单一返回协议');
assert.match(initializationPrompts.systemPrompt, /A\.parentId 等于 B\.id[\s\S]*保留 parentId 并删除对应外部关联[\s\S]*只针对直接父子/, '初始化提示词必须声明直接父子与外部关联互斥');
assert.match(initializationPrompts.userPrompt, /world_book_data/, '初始化提示词必须传递世界书内容');
assert.match(initializationPrompts.userPrompt, /main_chat_data/, '初始化提示词必须传递已有正文');
assert.deepEqual(initializationPrompts, buildCanonicalTodayTrendInitializationEnvelope({ context: collectedContext }),
    '兼容 facade 必须逐字符委托今日风向初始化提示词实现');

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
assert.match(generationPrompts.systemPrompt, /顶层必须且只能有 world、reputation、factions、dynamics/, '后续生成必须锁定四模块协议');
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
const statusContainer = {
    addEventListener: (type, listener) => { statusListeners[type] = listener; }, removeEventListener: () => {}, contains: () => true,
    querySelectorAll: selector => selector.includes('today-trend-set-circle-status') ? statusOptions : [],
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
    render: async () => { refreshStatusOptions(); }, onStatus: message => statusMessages.push(message), onError: error => statusErrors.push(error),
});
const statusButton = dataset => {
    const button = { disabled: false, dataset: { action: 'today-trend-set-circle-status', ...dataset }, focusCount: 0 };
    button.closest = () => button;
    button.focus = () => { button.focusCount += 1; };
    return button;
};
const refreshStatusOptions = () => { statusOptions = ['hostile', 'dislike', 'neutral', 'like', 'trust'].map(status => statusButton({ circleId: 'judge', status })); };
refreshStatusOptions();
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
const refreshKeyboardOptions = () => { keyboardOptions = ['hostile', 'dislike', 'neutral', 'like', 'trust'].map(createKeyboardOption); };
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
const refreshConcurrentOptions = () => { concurrentOptions = ['hostile', 'dislike', 'neutral', 'like', 'trust'].map(createConcurrentOption); };
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
const nonAssistantSnapshot = roleParsingScheduler.observe([{ role: 'user', content: '用户消息' }, { role: 'system', content: '系统消息' }]);
assert.equal(nonAssistantSnapshot.assistantCount, 0, 'role/content 形态的用户和系统消息不得被误判为 assistant 楼层');
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

assert.match(await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/today-trend.js', import.meta.url), 'utf8')),
    /initializeTodayTrend[\s\S]*bindTodayTrendPreset[\s\S]*commitTodayTrendScope/, '安装层必须公开初始化、预设绑定与设置提交接口');
const [phoneCode, scenePhoneCode, sceneCode] = await Promise.all(['today-trend-phone-ui.js', 'interactive-scene-phone.js', 'interactive-scenes.js'].map(async file =>
    import('node:fs/promises').then(({ readFile }) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'))));
assert.match(phoneCode, /persistPhoneUiSnapshot\?\.\(\)/, '展示今日风向后必须保存页面状态');
assert.match(scenePhoneCode, /PHONE_UI_PAGES\.includes\(page\)/, '页面状态保存必须复用统一页面白名单');
assert.match(sceneCode, /lastPage === 'today-trend'[\s\S]*showTodayTrendPage/, '页面恢复必须覆盖今日风向');

console.log('Today trend contracts verified.');
