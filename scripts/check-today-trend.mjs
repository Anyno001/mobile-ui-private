import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installTodayTrend } from '../src/today-trend.js';
import { createTodayTrendPhoneController } from '../src/today-trend-phone-controller.js';
import { installTodayTrendPhoneUi } from '../src/today-trend-phone-ui.js';
import { PHONE_UI_PAGES } from '../src/interactive-scene-model.js';
import { renderPhoneDesktop } from '../src/interactive-scene-views.js';
import {
    advanceTodayTrendEvent, archiveTodayTrendEvent, copyTodayTrendScope, createEmptyTodayTrendStore,
    createDefaultTodayTrendDynamicsSettings, promoteTodayTrendUnderground, settleTodayTrendRumor, TODAY_TREND_EVENT_LIFECYCLES, TODAY_TREND_EVENT_OUTCOMES,
    TODAY_TREND_EVENT_TYPES, TODAY_TREND_OPERATION_MODES, TODAY_TREND_RELATION_STATUSES, TODAY_TREND_STATUS_LABELS,
    TODAY_TREND_VERSION, migrateTodayTrendStore, normalizeTodayTrendStore,
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
import { createTodayTrendScheduler } from '../src/today-trend-scheduler.js';
import { renderTodayTrendInjection } from '../src/today-trend-injection.js';
import { renderTodayTrendApp } from '../src/today-trend-view.js';
import { renderTodayTrendWorldView } from '../src/today-trend-world-view.js';
import { renderTodayTrendReputationView } from '../src/today-trend-reputation-view.js';
import { renderTodayTrendFactionView } from '../src/today-trend-faction-view.js';
import { renderTodayTrendDynamicsView } from '../src/today-trend-dynamics-view.js';
import { renderTodayTrendSettingsView } from '../src/today-trend-settings-view.js';
import { createTodayTrendActionDispatcher } from '../src/today-trend-actions.js';
import { trendActionMenu, trendInlineActions, trendRuleEditor } from '../src/today-trend-ui.js';

assert.equal(TODAY_TREND_VERSION, 1);
for (const contract of [
    installTodayTrend, normalizeTodayTrendStore, createTodayTrendStorage, createTodayTrendCommitter,
    gatherTodayTrendContext, buildTodayTrendInitializationEnvelope, buildTodayTrendGenerationEnvelope,
    createTodayTrendGenerationController, createTodayTrendScheduler, renderTodayTrendInjection,
    renderTodayTrendApp, renderTodayTrendWorldView, renderTodayTrendReputationView,
    renderTodayTrendFactionView, renderTodayTrendDynamicsView, renderTodayTrendSettingsView,
    createTodayTrendActionDispatcher, installTodayTrendPhoneUi, renderPhoneDesktop,
]) assert.equal(typeof contract, 'function');
const todayTrendStyle = await readFile(new URL('../style.css', import.meta.url), 'utf8');
for (const variable of ['--pm-today-trend-report-gap', '--pm-today-trend-report-rule', '--pm-today-trend-track-width', '--pm-today-trend-node-size']) {
    assert.match(todayTrendStyle, new RegExp(`${variable}:`), `今日风向重排必须声明 ${variable} 视觉变量`);
}
const todayTrendAssetPaths = [
    ...['world'].flatMap(module => ['top.svg', 'middle-repeat.svg', 'bottom.svg'].map(name => `../assets/today-trend/${module}/${name}`)),
    ...['reputation', 'faction', 'dynamics'].flatMap(module => ['top.svg', 'top-glow.svg', 'middle-repeat.svg', 'bottom.svg'].map(name => `../assets/today-trend/${module}/${name}`)),
    '../assets/today-trend/world/starlight.svg', '../assets/today-trend/world/starlight-fine.svg',
];
const todayTrendAssets = await Promise.all(todayTrendAssetPaths.map(assetPath => readFile(new URL(assetPath, import.meta.url), 'utf8')));
for (const svg of todayTrendAssets) {
    assert.match(svg, /<svg\b[^>]*\bviewBox="0 0 390 (?:220|240)"/, '今日风向背景资源必须使用约定 viewBox');
    assert.ok((svg.match(/=(?:"|')#[0-9a-fA-F]{3,8}(?:"|')/g) || []).every(attribute => /=["']#000000["']/.test(attribute)), '今日风向背景资源只能使用黑色 alpha mask');
    assert.doesNotMatch(svg, /<(?:image|script|foreignObject)\b|(?:href|xlink:href)=(?:"|')https?:\/\//, '今日风向背景资源不得包含外部内容或位图');
}
assert.match(todayTrendStyle, /pm-today-trend-dynamics\{--pm-today-trend-bg-top-glow:url\("\.\/assets\/today-trend\/dynamics\/top-glow\.svg"\)/, '事件追踪必须声明 SVG 资源路径');
assert.match(todayTrendStyle, /-webkit-mask-image:var\(--pm-today-trend-bg-top\),var\(--pm-today-trend-bg-middle\),var\(--pm-today-trend-bg-bottom\)/, '背景图形必须使用 WebKit 多层 mask');
assert.match(todayTrendStyle, /mask-mode:alpha,alpha,alpha/, '背景图形必须显式使用 alpha mask');
assert.match(todayTrendStyle, /mask-repeat:no-repeat,repeat-y,no-repeat/, '背景中段必须仅沿纵向重复');
assert.match(todayTrendStyle, /pm-today-trend-world::before[\s\S]*?pointer-events:none/, 'SVG 背景层不得拦截交互');
assert.match(todayTrendStyle, /pm-today-trend-world>\*,\.pm-today-trend-reputation>\*[^}]*z-index:var\(--pm-z-base\)/, '模块内容必须位于 SVG 背景层之上');
assert.match(todayTrendStyle, /pm-today-trend-world-grid\{[^}]*background:color-mix\(in srgb,var\(--pm-color-accent\) 38%,transparent\)/, '世界态势重复网格必须独立于星光并降低强度');
assert.match(todayTrendStyle, /pm-today-trend-world-grid\{[^}]*linear-gradient\(45deg,transparent 0%,#000 29%,#000 71%,transparent 100%\)[^}]*mask-composite:intersect/, '世界态势重复网格必须在右上与左下淡出');
assert.match(todayTrendStyle, /pm-today-trend-factions::after,\.pm-today-trend-dynamics::after\{[^}]*mask-image:var\(--pm-today-trend-bg-top\),var\(--pm-today-trend-bg-bottom\)/, '势力与事件追踪背景必须隐藏中段重复图形');
assert.match(todayTrendStyle, /pm-today-trend-dynamics-target\{[^}]*position:absolute[^}]*left:calc\(100% \+ var\(--pm-space-1\)\)[^}]*width:calc\(var\(--pm-space-5\) \+ var\(--pm-space-5\) \+ var\(--pm-space-5\)\)/, '事件靶心必须以原始大尺寸定位在标题右侧');
assert.match(todayTrendStyle, /pm-today-trend-world\{padding-bottom:calc\(var\(--pm-space-5\) \+ var\(--pm-space-5\) \+ var\(--pm-space-5\)\)\}\.pm-today-trend-reputation,\.pm-today-trend-factions,\.pm-today-trend-dynamics\{padding-bottom:calc\(var\(--pm-space-5\) \+ var\(--pm-space-5\) \+ var\(--pm-space-5\)\)/, '四个模块必须为底部背景保留三档大间距');




assert.match(todayTrendStyle, /@media\(max-width:320px\).*pm-today-trend-event-facts/s, '今日风向重排必须提供窄屏事实区适配');
assert.match(todayTrendStyle, /pm-today-trend-icon-button\[data-action\^="today-trend-refresh"\][\s\S]*?width:var\(--pm-size-control-compact\)[\s\S]*?min-height:var\(--pm-size-control-compact\)/, '生成与刷新图标按钮必须保留 36px 紧凑触控区');
assert.match(todayTrendStyle, /pm-today-trend-reputation-copy \.pm-today-trend-inline-action\{width:var\(--pm-size-control-compact\);min-height:var\(--pm-size-control-compact\)/, '个人风评行内编辑按钮必须保留 36px 紧凑触控区');
assert.match(todayTrendStyle, /\.pm-today-trend-menu-action,\.pm-today-trend-menu-close\{flex-basis:var\(--pm-size-control-compact\);width:var\(--pm-size-control-compact\);min-height:var\(--pm-size-control-compact\)/, '320px 菜单按钮不得缩回 28px 命中区');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-(?:icon-button\[data-action\^="today-trend-(?:refresh|generate)"\]|reputation-copy \.pm-today-trend-inline-action)\{width:28px/, '今日风向真实操作按钮不得使用 28px 命中区');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-content\.is-(?:reputation|faction|dynamics)::/, '旧内容容器背景伪元素必须清理');
assert.match(todayTrendStyle, /pm-today-trend-faction-card\[data-depth="0"\][^}]*border:2px solid color-mix/, '势力根节点必须改为空心主题节点，而非危险色实心点');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-faction-card\[data-depth="0"\]>.pm-today-trend-faction-node\{background:var\(--pm-color-danger\)\}/, '势力根节点不得保留危险色实心点覆盖规则');
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
const phoneController = createTodayTrendPhoneController({ state: controllerState, container: controllerContainer, deps: {
    getStorageId: () => 'chat', getTodayTrendStore: async () => valid,
    getTodayTrendGenerationState: () => ({ phase: 'idle' }),
    commitTodayTrendScope: async () => valid, cancelTodayTrendInitialization: reason => { controllerCancelReason = reason; },
} });
assert.equal(await phoneController.render(), true, '控制器必须渲染当前聊天的今日风向页面');
assert.match(controllerContainer.innerHTML, /id="pm-today-trend-app"/, '控制器必须渲染今日风向页面壳');
assert.deepEqual(controllerListeners.map(item => controllerListenerKey(item.type, item.capture)).sort(), ['click:bubble', 'click:capture', 'keydown:bubble', 'submit:bubble', 'submit:bubble'], '控制器必须恰好注册并区分自身与动作分发器的 click、submit 与 keydown 代理事件');
phoneController.destroy();
assert.equal(controllerCancelReason, 'today-trend-page-destroyed', '销毁控制器必须取消初始化任务');
assert.equal(controllerListeners.length, 0, '销毁控制器必须解绑所有事件代理');
const firstUseHtml = renderTodayTrendApp({ presets: [{ id: 'preset', name: '综艺世界' }], worldBooks: ['厨房设定'] });
assert.match(firstUseHtml, /data-today-trend-form="initialize"/, '首次使用必须提供初始化表单');
assert.match(firstUseHtml, /name="worldBookNames"/, '初始化必须要求选择世界书');
assert.match(firstUseHtml, /data-today-trend-form="bind-preset"/, '已有预设必须可直接绑定当前聊天');
const failedInitializationHtml = renderTodayTrendApp({ presets: [{ id: 'preset', name: '综艺世界' }], worldBooks: ['厨房设定', '节目规则'], error: '初始化失败',
    initializationDraft: { presetName: '晚间赛制', worldBookNames: ['节目规则'], includeExistingChat: false, userRequirements: '保留淘汰规则' } });
assert.match(failedInitializationHtml, /value="晚间赛制"/, '初始化失败后必须保留预设名称草稿');
assert.match(failedInitializationHtml, /value="节目规则" checked/, '初始化失败后必须保留世界书选择');
assert.doesNotMatch(failedInitializationHtml, /name="includeExistingChat" type="checkbox" checked/, '初始化失败后必须保留正文开关');
assert.match(failedInitializationHtml, /保留淘汰规则/, '初始化失败后必须保留追加要求');
const appHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), generation: { phase: 'idle' } });
for (const label of ['世界态势', '个人风评', '势力图谱', '事件追踪']) assert.match(appHtml, new RegExp(label), `主页面必须装配${label}`);
assert.match(appHtml, /today-trend-open-settings/, '主页面必须提供 APP 总设置入口');
assert.match(appHtml, /today-trend-toggle-operation[\s\S]*aria-pressed="true"/, '主页面必须提供当前运行状态的直接控制');
const reinitializeHtml = renderTodayTrendApp({ scope: valid.scopes.chat, presets: Object.values(valid.presets), worldBooks: ['厨房设定'], initializationOpen: true, reinitializing: true });
assert.match(reinitializeHtml, /重新初始化当前今日风向/, '重新初始化必须复用两步初始化表单');
assert.match(reinitializeHtml, /today-trend-cancel-initialize/, '重新初始化必须允许安全取消');
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
assert.match(ruleEditorHtml, /data-today-trend-form="rule-editor"/, '规则编辑必须使用同页表单');
assert.match(ruleEditorHtml, /name="rule" value="world"/, '规则编辑必须携带规则标识');
assert.match(ruleEditorHtml, /textarea[^>]*name="text"[^>]*required/, '规则编辑必须要求非空 Prompt');
const worldHtml = renderTodayTrendWorldView({ scope: valid.scopes.chat, generationAvailable: true, menuOpenId: 'world-module' });
const worldPanelsHtml = renderTodayTrendWorldView({ scope: { ...valid.scopes.chat, world: { items: [...valid.scopes.chat.world.items, { id: 'world-brief', name: '后勤消息', summary: '补给已抵达' }, { id: 'world-terminal', name: '航线警报', summary: '航线出现扰动' }] } } });
assert.match(worldHtml, /节目风向/, '世界态势页必须渲染初始化生成的世界观项目');
assert.match(worldHtml, /data-world-item-id="world"[\s\S]*?today-trend-refresh-world-item/, '世界态势顶级操作打开时必须联动显示摘要操作');
assert.doesNotMatch(renderTodayTrendWorldView({ scope: valid.scopes.chat, generationAvailable: true }), /today-trend-refresh-world-item/, '世界态势顶级操作关闭时必须隐藏摘要操作');
assert.doesNotMatch(worldPanelsHtml, /pm-today-trend-world-panel/, '世界态势摘要不得套用方角内容容器');
assert.doesNotMatch(worldPanelsHtml, /pm-today-trend-world-(?:ornament|left-ornament|terminal|dotfield)/, '世界态势摘要不得保留旧装饰节点');
assert.doesNotMatch(worldHtml, /WORLD SITUATION|pm-today-trend-world-(?:title-rail|title-dotfield|kicker|starfield)/, '世界态势不得保留旧标题轨或星图装饰');
assert.match(worldPanelsHtml, /pm-today-trend-world-hero has-signals/, '世界态势主摘要必须标记后续信号流');
assert.match(worldPanelsHtml, /pm-today-trend-world-signals/, '世界态势次级摘要必须位于信号流容器');
assert.match(worldPanelsHtml, /pm-today-trend-world-signal-marker[^>]*aria-hidden="true"><i><\/i><\/span>/, '世界态势信号必须包含外环与实心内芯');
assert.match(todayTrendStyle, /pm-today-trend-world-signals::before[^}]*border-left:1px dashed/, '世界态势左侧信号必须使用连续主干');
assert.match(todayTrendStyle, /pm-today-trend-world-brief\.is-right::after[^}]*bottom:var\(--pm-space-3\)/, '右侧信号线必须延伸至摘要说明底部');
assert.match(todayTrendStyle, /pm-today-trend-world-brief\.is-left \.pm-today-trend-world-signal-marker\{top:calc\(var\(--pm-space-4\) \* -1\)\}/, '左侧摘要信号标记必须上移，明确与前一摘要的收束关系');
assert.match(todayTrendStyle, /pm-today-trend-world-brief\.is-right\{margin-top:calc\(\(var\(--pm-space-4\) \+ var\(--pm-space-2\)\) \* -1\);margin-right:0;margin-bottom:var\(--pm-space-2\);margin-left:calc\(24% - var\(--pm-space-4\)\)\}/, '右侧摘要必须在保留正文安全间距和后续呼吸的前提下上移并按节点基准左移');
assert.match(todayTrendStyle, /pm-today-trend-world-signal-marker::after[^}]*width:var\(--pm-space-4\)/, '世界态势信号必须包含有限横向引线');
assert.doesNotMatch(todayTrendStyle, /pm-today-trend-world-hero::before/, '世界态势不得恢复旧主摘要伪元素装饰');
assert.doesNotMatch(worldHtml, /data-menu-id="world:/, '世界摘要不得重复渲染独立省略号');
assert.match(worldHtml, /today-trend-generate-world/, '世界态势页必须提供本模块生成动作');
assert.match(worldHtml, /aria-busy="false"/, '世界态势生成按钮必须提供非忙碌 ARIA 状态');
const busyWorldHtml = renderTodayTrendWorldView({ scope: valid.scopes.chat, generationAvailable: true, generationBusy: true, menuOpenId: 'world-module' });
assert.match(busyWorldHtml, /today-trend-refresh-world-item"[^>]*disabled aria-busy="true"/, '忙碌时世界态势单项刷新必须禁用并暴露忙碌状态');
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
assert.match(reputationHtml, /主厨评审/, '个人风评页必须渲染世界观圈层名称');
assert.match(reputationHtml, /中立/, '个人风评页必须渲染固定五档状态的中文标签');
assert.match(reputationHtml, /pm-today-trend-reputation-entry/, '个人风评内容页必须使用观察报告条目结构');
assert.match(reputationHtml, /PUBLIC OPINION/, '个人风评内容页必须提供报告识别语');
assert.doesNotMatch(reputationHtml, /观察圈层｜|个正向、|个谨慎或中性|等待建立观察圈层/, '个人风评报告头不得展示冗余统计或伪造时间');
assert.match(reputationHtml, /pm-today-trend-reputation-index" aria-hidden="true"><span>01<\/span><i><\/i><\/span>/, '个人风评编号必须保留动态数字并提供框角装饰钩子');

assert.match(reputationHtml, /01/, '个人风评内容页必须从数据顺序派生观察编号');
assert.match(reputationHtml, /data-status="neutral"/, '个人风评状态必须提供主题化样式钩子');
assert.doesNotMatch(reputationHtml, /pm-today-trend-reputation-orbit/, '个人风评背景不得局限在模块子容器内');
assert.match(reputationMenuHtml, /today-trend-edit-reputation-rule/, '展开个人风评模块操作后必须提供规则编辑动作');
assert.doesNotMatch(reputationHtml, /today-trend-edit-circle/, '个人风评收起模块操作时不得显示单条编辑入口');
assert.match(reputationHtml, /pm-today-trend-reputation-meter" role="radiogroup" aria-label="修改主厨评审的好感度，当前：中立"/, '个人风评必须为每条记录输出可访问的好感度单选组');
assert.equal((reputationHtml.match(/data-action="today-trend-set-circle-status"/g) || []).length, valid.scopes.chat.reputation.circles.length * 5, '个人风评每条记录必须输出五个实时状态按钮');
assert.match(reputationHtml, /data-circle-id="judge" data-status="neutral" aria-checked="true" role="radio"/, '当前好感度按钮必须暴露选中语义');
assert.match(reputationHtml, /data-circle-id="judge" data-status="like" aria-checked="false" role="radio"/, '非当前好感度按钮必须暴露未选中语义');
assert.doesNotMatch(reputationHtml, /aria-hidden="true"><i><\/i><span>/, '个人风评五档不得再渲染为隐藏的静态条目');
for (const label of ['敌对', '厌恶', '中立', '喜爱', '信任']) assert.match(reputationHtml, new RegExp(`>${label}<`), `个人风评必须显式显示五档好感度：${label}`);
assert.doesNotMatch(reputationHtml, /today-trend-refresh-circle/, '个人风评内容区不得保留单项重新生成入口');
assert.match(reputationMenuHtml, /today-trend-edit-circle[^>]*data-circle-id="judge"/, '展开个人风评模块操作后，每条风评必须出现编辑铅笔');
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
assert.match(todayTrendStyle, /pm-today-trend-reputation::after,\.pm-today-trend-factions::after,\.pm-today-trend-dynamics::after\{[^}]*mask-image:var\(--pm-today-trend-bg-top\),var\(--pm-today-trend-bg-bottom\)/, '个人风评、势力和事件背景必须保留顶部与底部图形并隐藏中段重复图形');
assert.match(todayTrendStyle, /pm-today-trend-reputation-index\{[^}]*font-weight:var\(--pm-font-weight-semibold\)/, '个人风评编号必须使用加粗文字而非圆形外框');
assert.match(todayTrendStyle, /pm-today-trend-reputation-index>i\{[^}]*border-top:1px solid[^}]*border-right:1px solid/, '个人风评编号必须提供右侧框角装饰');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry\{[^}]*grid-template-columns:var\(--pm-today-trend-track-width\) minmax\(0,1fr\) var\(--pm-today-trend-reputation-meter-width\)/, '个人风评条目必须保持轨道、正文和量表三列流式布局');
assert.match(todayTrendStyle, /pm-today-trend-reputation-entry::before\{[^}]*border-left:var\(--pm-today-trend-report-rule\) solid var\(--pm-today-trend-reputation-rail-color\)/, '个人风评条目必须保留竖线引导线');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter\{[^}]*border-right:1px solid var\(--pm-today-trend-reputation-rail-color\)[^}]*border-left:1px solid var\(--pm-today-trend-reputation-rail-color\)/, '个人风评量表必须保留左右刻度框体');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button:focus-visible/, '个人风评状态按钮必须提供键盘焦点样式');
assert.match(todayTrendStyle, /pm-today-trend-reputation-meter button:disabled/, '个人风评状态按钮必须提供禁用样式');
const factionHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, menuOpenId: 'faction-module' });
assert.match(factionHtml, /红队/, '势力页必须渲染根势力');
assert.match(factionHtml, /节目组/, '势力页必须递归渲染子势力');
assert.match(factionHtml, /队长/, '势力卡片必须直接展示关键资料');
assert.match(factionHtml, /POWER MAP/, '势力内容页必须提供图谱识别语');
assert.match(factionHtml, /pm-today-trend-faction-tree" data-depth="0"/, '势力图谱必须标识根层级');
assert.match(factionHtml, /pm-today-trend-faction-card"[^>]*data-depth="1"/, '势力图谱必须标识子层级');
assert.doesNotMatch(factionHtml, /pm-today-trend-external-list|pm-today-trend-external-relation/, '外部关联不得再单独列成第二份势力清单');
assert.match(factionHtml, /pm-today-trend-faction-node/, '势力图谱必须输出独立节点装饰');
assert.doesNotMatch(factionHtml, /pm-today-trend-faction-constellation/, '势力背景不得局限在模块子容器内');
assert.match(factionHtml, /today-trend-edit-faction-rule/, '势力图谱模块必须提供规则编辑动作');
assert.doesNotMatch(factionHtml, /today-trend-refresh-faction/, '势力图谱内容区不得保留单项重新生成入口');
const busyFactionHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, generationAvailable: true, generationBusy: true, menuOpenId: 'faction-module' });
assert.match(busyFactionHtml, /today-trend-generate-factions"[^>]*disabled aria-busy="true"/, '忙碌时势力模块生成必须禁用并暴露忙碌状态');
assert.match(renderTodayTrendReputationView({ scope: valid.scopes.chat, mode: 'settings', menuOpenId: 'reputation-settings' }), /today-trend-regenerate-circle-schema/, '个人风评设置顶级操作打开后必须提供结构重新生成动作');
const factionEditorHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, mode: 'editor', editingFactionId: 'red' });
assert.match(factionEditorHtml, /name="parentId"/, '势力编辑页必须提供可空父势力选择');
const busyFactionSettingsHtml = renderTodayTrendFactionView({ scope: valid.scopes.chat, mode: 'settings', generationAvailable: true, generationBusy: true });
assert.doesNotMatch(busyFactionSettingsHtml, /today-trend-regenerate-faction-rule/, '势力图谱设置不得重复提供模块规则动作');
const busyDynamicsHtml = renderTodayTrendDynamicsView({ scope: valid.scopes.chat, preset: valid.presets.preset, generationAvailable: true, generationBusy: true, menuOpenId: 'dynamics-module' });
assert.match(busyDynamicsHtml, /today-trend-advance-all-events[\s\S]*?disabled aria-busy="true"/, '忙碌时动态模块生成必须禁用并暴露忙碌状态');
assert.match(busyDynamicsHtml, /today-trend-edit-dynamics-rule/, '动态模块必须提供规则编辑动作');
assert.match(busyDynamicsHtml, /事件追踪<span class="pm-today-trend-dynamics-target" aria-hidden="true">/, '事件靶心必须紧随事件追踪标题渲染');

assert.match(busyDynamicsHtml, /today-trend-open-dynamics-settings/, '动态模块必须保留专属设置动作');
assert.doesNotMatch(busyDynamicsHtml, /today-trend-advance-event/, '动态内容区不得保留单项推进入口');
assert.match(busyDynamicsHtml, /EVENT TRACKER/, '动态内容页必须提供追踪识别语');
assert.match(busyDynamicsHtml, /pm-today-trend-event-facts/, '动态内容页必须提供结构化事件事实区');
assert.match(busyDynamicsHtml, /pm-today-trend-event-history/, '动态内容页必须提供阶段时间线容器');
assert.match(busyDynamicsHtml, /pm-today-trend-event-marker" aria-hidden="true"/, '事件追踪卡片必须包含左侧节点');
assert.match(busyDynamicsHtml, /pm-today-trend-event-body/, '事件追踪卡片必须将内容与左侧节点分层');
assert.match(todayTrendStyle, /pm-today-trend-event-list::before\{[^}]*border-left/, '事件追踪列表必须使用左侧连续轨道');
assert.match(todayTrendStyle, /pm-today-trend-event-card\{[^}]*grid-template-columns:var\(--pm-today-trend-dynamics-rail\) minmax\(0,1fr\)/, '事件追踪卡片必须使用节点与正文双列网格');
assert.doesNotMatch(busyDynamicsHtml, /pm-today-trend-dynamics-signal|pm-today-trend-dynamics-arc/, '事件背景不得局限在模块子容器内或保留灰色弧线');
assert.match(busyDynamicsHtml, /正在生成…/, '忙碌时动态模块必须展示生成状态');
assert.match(factionEditorHtml, /name="detailLabel"/, '势力编辑页必须提供动态关键资料编辑');
assert.match(factionEditorHtml, /name="status"/, '势力编辑页必须提供固定五档关系选择');
assert.match(factionEditorHtml, /data-action="today-trend-add-detail"/, '势力编辑页必须提供关键资料添加动作');
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
assert.match(dynamicsHtml, /正在追踪/, '动态页必须区分正在追踪事件');
assert.match(dynamicsHtml, /已完结/, '动态页必须区分归档事件');
assert.match(dynamicsHtml, /data-event-type="normal"/, '动态事件必须暴露类型样式钩子');
assert.match(dynamicsHtml, /today-trend-open-dynamics-settings/, '动态页必须提供设置入口');
assert.match(dynamicsHtml, /today-trend-edit-dynamics-rule/, '动态页必须提供模块 Prompt 编辑入口');
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
let resolveInstalledInitialization;
const installedDeps = {
    runtime: {}, getStorageId: () => 'chat', getCtx: () => ({ characterId: 'character', characters: { character: { avatar: 'character', name: '小明' } }, chat: [] }),
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
const dispatcherRenders = [];
const dispatcherListeners = {};
const dispatcherContainer = {
    addEventListener: (type, listener) => { dispatcherListeners[type] = listener; },
    removeEventListener: () => {}, contains: () => true,
};
const dispatcher = createTodayTrendActionDispatcher({
    container: dispatcherContainer, getStorageId: () => 'chat', getStore: async () => valid,
    committer: { commitScope: async () => valid }, render: async view => { dispatcherRenders.push(view); },
    onSaveRule: async (...args) => { savedRules.push(args); }, onRegenerateRule: async rule => { regeneratedRules.push(rule); },
});
for (const [action, rule] of [['today-trend-edit-dynamics-rule', 'dynamics'], ['today-trend-edit-incident-rule', 'dynamics-incident'], ['today-trend-edit-rumor-rule', 'dynamics-rumor'], ['today-trend-edit-underground-rule', 'dynamics-underground']]) {
    const button = { disabled: false, dataset: { action }, closest: () => button };
    dispatcherListeners.click({ target: button });
    await Promise.resolve();
    assert.equal(dispatcher.state().editingRule, rule, '规则编辑动作必须打开同页编辑器');
}
const regenerateButton = { disabled: false, dataset: { action: 'today-trend-regenerate-dynamics-rule' }, closest: () => regenerateButton };
dispatcherListeners.click({ target: regenerateButton });
await Promise.resolve();
assert.deepEqual(regeneratedRules, ['dynamics'], '规则重新生成必须分发到正确目标');
const cancelRuleButton = { disabled: false, dataset: { action: 'today-trend-cancel-rule-editor' }, closest: () => cancelRuleButton };
dispatcherListeners.click({ target: cancelRuleButton });
await Promise.resolve();
assert.equal(dispatcher.state().editingRule, null, '取消规则编辑必须清空编辑状态');
assert.ok(dispatcherRenders.length > 0, '规则动作必须触发重新渲染');
assert.deepEqual(savedRules, [], '规则编辑打开前不得错误提交 Prompt');
dispatcher.destroy();

let statusStore = structuredClone(valid);
let statusCommitCount = 0;
const statusMessages = [];
const statusErrors = [];
const statusListeners = {};
const statusDispatcher = createTodayTrendActionDispatcher({
    container: { addEventListener: (type, listener) => { statusListeners[type] = listener; }, removeEventListener: () => {}, contains: () => true },
    getStorageId: () => 'chat', getStore: async () => statusStore,
    committer: { commitScope: async (storageId, mutate) => {
        statusCommitCount += 1;
        const scope = await mutate(structuredClone(statusStore.scopes[storageId]));
        statusStore = { ...statusStore, scopes: { ...statusStore.scopes, [storageId]: scope } };
        return statusStore;
    } },
    render: async () => {}, onStatus: message => statusMessages.push(message), onError: error => statusErrors.push(error),
});
const statusButton = dataset => { const button = { disabled: false, dataset: { action: 'today-trend-set-circle-status', ...dataset } }; button.closest = () => button; return button; };
statusListeners.click({ target: statusButton({ circleId: 'judge', status: 'like' }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(statusStore.scopes.chat.reputation.circles.find(circle => circle.id === 'judge').status, 'like', '点击好感度按钮必须仅更新目标圈层状态');
assert.equal(statusCommitCount, 1, '修改好感度必须走正式提交链');
assert.deepEqual(statusMessages, ['个人风评好感度已更新。'], '好感度提交成功后必须报告状态');
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
let schedulerCalls = 0;
const scheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => {
        schedulerCalls += 1;
        return {
            scope: { ...scope, world: { items: [{ ...scope.world.items[0], summary: `已更新${schedulerCalls}` }] } },
        };
    } },
    committer: schedulerCommitter, getStore: async () => scheduledStore, getStorageId: () => 'chat',
    getChat: () => [{ mes: '第一楼' }, { mes: '第二楼' }, { mes: '第三楼' }], now: () => 100,
});
const autoSnapshot = scheduler.observe([{ mes: '第一楼' }, { mes: '第二楼' }, { mes: '第三楼' }]);
assert.equal(autoSnapshot.assistantCount, 3, '自动调度只能按已完成的 assistant 正文计楼');
assert.equal(scheduler.observe([{ role: 'user', content: '用户消息' }, { role: 'system', content: '系统消息' }]), null,
    'role/content 形态的用户和系统消息不得被误判为 assistant 楼层');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(schedulerCalls, 1, '达到每 N 楼阈值后必须只启动一次统一生成');
assert.equal(scheduledStore.scopes.chat.operation.lastSuccessfulAssistantCount, 3, '自动成功后必须推进 checkpoint');
scheduledStore.scopes.chat.operation.lastSuccessfulAssistantCount = 80;
const longChat = Array.from({ length: 82 }, (_, index) => ({ mes: `第${index + 1}楼` }));
scheduler.observe(longChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(schedulerCalls, 2, '超过最近正文窗口后仍必须按完整 assistant 楼层继续调度');
await scheduler.manual();
assert.equal(schedulerCalls, 3, '手动本轮生成必须复用统一生成链');
assert.equal(scheduledStore.scopes.chat.operation.lastSuccessfulAssistantCount, 3, '手动成功必须同步当前 checkpoint');

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
await targetedScheduler.run({ kind: 'manual', assistantCount: 12, target: { module: 'world', itemId: 'world' } });
assert.equal(targetedSchedulerStore.scopes.chat.operation.lastSuccessfulAssistantCount, 7, '定向刷新不得推进持久化楼层 checkpoint');
assert.equal(targetedScheduler.state().baselines.chat, 10, '定向刷新不得推进自动调度基线');

let armCalls = 0;
const armedScheduler = createTodayTrendScheduler({
    controller: { generate: async ({ scope }) => { armCalls += 1; return { scope }; } }, committer: schedulerCommitter,
    getStore: async () => scheduledStore, getStorageId: () => 'chat',
});
const initialChat = Array.from({ length: 10 }, (_, index) => ({ mes: `旧楼层${index}` }));
assert.equal(armedScheduler.arm('chat', initialChat), 10, '开始运作必须立即记录当前 assistant 楼层基线');
const newlyCompleted = [...initialChat, { mes: '新楼层1' }, { mes: '新楼层2' }];
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
let queuedAutoStore = structuredClone(valid);
queuedAutoStore.scopes.chat.operation = { ...queuedAutoStore.scopes.chat.operation, enabled: true, mode: 'auto', intervalFloors: 2, lastSuccessfulAssistantCount: 2 };
const queuedAutoCommitter = createTodayTrendCommitter({
    load: async () => queuedAutoStore,
    save: async value => { queuedAutoStore = structuredClone(value); return queuedAutoStore; },
    refreshInjection: async () => ({ failedWrites: 0, failedKeys: [] }),
});
const queuedAutoScheduler = createTodayTrendScheduler({
    controller: { generate: ({ scope }) => {
        queuedAutoCalls += 1;
        return queuedAutoCalls === 1
            ? new Promise(resolve => { releaseQueuedAuto = () => resolve({ scope }); })
            : Promise.resolve({ scope });
    } },
    committer: queuedAutoCommitter, getStore: async () => queuedAutoStore, getStorageId: () => 'chat', getChat: () => queuedAutoChat,
});
queuedAutoScheduler.arm('chat', queuedAutoChat);
queuedAutoChat.push({ mes: '触发楼层一' }, { mes: '触发楼层二' });
queuedAutoScheduler.observe(queuedAutoChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(queuedAutoCalls, 1, '达到阈值时必须只启动一个自动任务');
queuedAutoChat.push({ mes: '生成期间楼层一' }, { mes: '生成期间楼层二' });
queuedAutoScheduler.observe(queuedAutoChat);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(queuedAutoCalls, 1, '生成期间的自动触发必须合并，不能并发调用 AI');
releaseQueuedAuto();
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(queuedAutoCalls, 2, '生成期间累计满下一阈值的新增楼层必须在提交后补调度，不能吞楼');
assert.equal(queuedAutoStore.scopes.chat.operation.lastSuccessfulAssistantCount, 6, '补调度成功后必须推进到最新助手楼层 checkpoint');

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

assert.match(await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/today-trend.js', import.meta.url), 'utf8')),
    /initializeTodayTrend[\s\S]*bindTodayTrendPreset[\s\S]*commitTodayTrendScope/, '安装层必须公开初始化、预设绑定与设置提交接口');
const [phoneCode, scenePhoneCode, sceneCode] = await Promise.all(['today-trend-phone-ui.js', 'interactive-scene-phone.js', 'interactive-scenes.js'].map(async file =>
    import('node:fs/promises').then(({ readFile }) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'))));
assert.match(phoneCode, /persistPhoneUiSnapshot\?\.\(\)/, '展示今日风向后必须保存页面状态');
assert.match(scenePhoneCode, /PHONE_UI_PAGES\.includes\(page\)/, '页面状态保存必须复用统一页面白名单');
assert.match(sceneCode, /lastPage === 'today-trend'[\s\S]*showTodayTrendPage/, '页面恢复必须覆盖今日风向');

console.log('Today trend contracts verified.');
