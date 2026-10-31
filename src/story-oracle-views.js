// 剧情助手页面模板：只根据视图模型输出 HTML，不读写存储、不发请求。
import {
    BACK_ICON_SVG, BOOK_ICON_SVG, CHAT_ICON_SVG, CHECK_ICON_SVG, CHEVRON_DOWN_ICON_SVG, FLAG_ICON_SVG, GAUGE_ICON_SVG, GRID_ICON_SVG, HOME_ICON_SVG,
    LINK_ICON_SVG, MORE_ICON_SVG, PAUSE_ICON_SVG, PLAY_ICON_SVG, ROUTE_ICON_SVG, SEND_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG, TRASH_ICON_SVG, USER_ICON_SVG,
    CLOSE_ICON_SVG, REFRESH_ICON_SVG, FORWARD_ICON_SVG,
} from './icons.js';
import { escapeAttr, escapeHtml, renderBoldText, renderSafeMarkdown, splitMarkdownBubbles } from './ui.js';
import { hasYamlBlock } from './plot-injector/core/prompts.js';
import {
    parseStoryPlans, parseUserGenerationResponse, storyOracleMessageId, storyOraclePlanInjectionText, storyOraclePlanIntensityControllable,
    stripStoryPlanMarkup, STORY_ORACLE_INTENSITIES, STORY_ORACLE_MODES,
} from './story-oracle-model.js';

export const MAX_QUESTION_CHARS = 12000;
export const TOP_VIEWS = Object.freeze(['home', 'plot', 'plans', 'users', 'settings']);
const MODE_LABELS = Object.freeze({ question: '剧情聊天', advisor: '剧情参谋', 'user-generation': 'User生成' });
const MODE_ICONS = Object.freeze({ question: CHAT_ICON_SVG, advisor: ROUTE_ICON_SVG, 'user-generation': USER_ICON_SVG });
const MODE_PLACEHOLDERS = Object.freeze({ question: '询问当前故事…', advisor: '描述你希望推进的剧情目标…', 'user-generation': '描述你想生成的User角色…' });
const CLEAR_LABELS = Object.freeze({ question: '清空剧情聊天记录', advisor: '清空剧情参谋记录', 'user-generation': '清空User生成记录' });
const INTENSITY_LEVELS = Object.freeze({ slow: 1, natural: 2, fast: 3 });

const disabledAttr = enabled => (enabled ? '' : 'disabled');
const planTitle = plan => plan.title || plan.goal || '未命名线路';
const firstChar = value => Array.from(String(value || '').trim())[0] || '';
const formatDate = timestamp => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
};
const formatChars = value => {
    const count = String(value || '').length;
    return count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k字` : `${count} 字`;
};
const newestFirst = plans => [...plans].sort((a, b) => b.createdAt - a.createdAt || b.order - a.order || b.id.localeCompare(a.id));

function renderIntensityMeter(plan, trailing = '') {
    const controllable = storyOraclePlanIntensityControllable(plan);
    const level = controllable ? INTENSITY_LEVELS[plan.intensity] || INTENSITY_LEVELS.natural : 0;
    const label = controllable ? STORY_ORACLE_INTENSITIES[plan.intensity]?.label || STORY_ORACLE_INTENSITIES.natural.label : '自定义节奏';
    const steps = [1, 2, 3].map(step => `<i${step <= level ? ' class="is-filled"' : ''}></i>`).join('');
    return `<span class="pm-story-oracle-meter" aria-hidden="true">${steps}</span><span class="pm-story-oracle-meter-label"><span>${label}</span>${trailing ? `<span>${escapeHtml(trailing)}</span>` : ''}</span>`;
}

const renderPlanPill = plan => `<span class="pm-story-oracle-pill${plan.enabled ? ' is-active' : ''}">${plan.enabled ? '引导中' : '未启用'}</span>`;

function renderPlanToggle(plan, writable) {
    const label = plan.enabled ? '停止引导' : '开始引导';
    return `<button type="button" class="pm-story-oracle-plan-status${plan.enabled ? ' is-active' : ''}" data-story-oracle-action="toggle-plan" data-story-oracle-plan-id="${escapeAttr(plan.id)}" aria-pressed="${plan.enabled}" aria-label="${label}：${escapeAttr(planTitle(plan))}" title="${label}" ${disabledAttr(writable)}>${plan.enabled ? PAUSE_ICON_SVG : PLAY_ICON_SVG}</button>`;
}
// 路线卡：引导中的最新一张用主题浅色块突出，其余白卡；状态按钮与打开详情是两个独立按钮。
function renderPlanCard(plan, writable, featured = false) {
    return `<article class="pm-story-oracle-card pm-story-oracle-plan-card${featured ? ' is-featured' : ''}" data-story-oracle-plan-id="${escapeAttr(plan.id)}">
      <div class="pm-story-oracle-card-head">${renderPlanPill(plan)}${renderPlanToggle(plan, writable)}</div>
      <button type="button" class="pm-story-oracle-card-body" data-story-oracle-action="open-plan" data-story-oracle-plan-id="${escapeAttr(plan.id)}">
        <b>${escapeHtml(planTitle(plan))}</b>${plan.goal && plan.goal !== plan.title ? `<span class="pm-story-oracle-card-text">${escapeHtml(plan.goal)}</span>` : ''}
        ${plan.enabled ? renderIntensityMeter(plan, formatDate(plan.createdAt)) : ''}
      </button>
    </article>`;
}

const renderSectionHead = (title, action = '') => `<div class="pm-story-oracle-section-head"><h3>${title}</h3>${action}</div>`;

function renderTopHeader(title, subtitle, seal = '') {
    return `<header class="pm-story-oracle-header">${seal ? `<span class="pm-story-oracle-seal" aria-hidden="true">${escapeHtml(seal)}</span>` : ''}<div class="pm-story-oracle-header-text"><h2>${title}</h2>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</div><button type="button" class="pm-story-oracle-icon-button" data-story-oracle-action="home" aria-label="返回桌面" title="返回桌面">${HOME_ICON_SVG}</button></header>`;
}

const renderBackButton = () => `<button type="button" class="pm-story-oracle-icon-button" data-story-oracle-action="back" aria-label="返回" title="返回">${BACK_ICON_SVG}</button>`;

function renderMoreMenu(id, items, open) {
    if (!items.length) return '<span class="pm-story-oracle-icon-spacer" aria-hidden="true"></span>';
    return `<div class="pm-story-oracle-more-wrap"><button type="button" class="pm-story-oracle-icon-button" data-story-oracle-action="toggle-more" data-story-oracle-menu-id="${escapeAttr(id)}" aria-haspopup="menu" aria-expanded="${open}" aria-label="更多操作" title="更多操作">${MORE_ICON_SVG}</button><div class="pm-control-menu pm-story-oracle-more-menu" role="menu" ${open ? '' : 'hidden'}>${items.join('')}</div></div>`;
}

function renderModeSheet(mode, open) {
    const options = STORY_ORACLE_MODES.map(item => `<button type="button" class="pm-story-oracle-mode-option${item === mode ? ' is-selected' : ''}" role="menuitemradio" data-story-oracle-action="mode" data-story-oracle-mode="${item}" aria-checked="${item === mode}"><span class="pm-story-oracle-mode-icon">${MODE_ICONS[item]}</span><span class="pm-story-oracle-mode-text"><b>${MODE_LABELS[item]}</b></span>${item === mode ? CHECK_ICON_SVG : ''}</button>`).join('');
    return `<div class="pm-story-oracle-sheet-layer" ${open ? '' : 'hidden'}><button type="button" class="pm-story-oracle-scrim" data-story-oracle-action="close-mode-sheet" aria-label="关闭模式选择" tabindex="-1"></button><div id="pm-story-oracle-mode-menu" class="pm-story-oracle-sheet" role="menu" aria-label="剧情助手模式">${options}</div></div>`;
}

function renderReceipt(plans, writable) {
    if (!plans.length) return '';
    const rows = plans.map(plan => `<div class="pm-story-oracle-receipt-row">${renderPlanToggle(plan, writable)}<button type="button" class="pm-story-oracle-receipt-title" data-story-oracle-action="open-plan" data-story-oracle-plan-id="${escapeAttr(plan.id)}">${escapeHtml(planTitle(plan))}</button></div>`).join('');
    return `<section class="pm-story-oracle-receipt" aria-label="本轮整理出的路线"><div class="pm-story-oracle-receipt-head"><b>整理出 ${plans.length} 条路线</b><button type="button" class="pm-story-oracle-link" data-story-oracle-action="view" data-story-oracle-view="plans">查看路线</button></div>${rows}</section>`;
}
// 参谋回复下方直接挂上它整理出的路线，按 sourceMessageId 对应到具体那条回复。
function renderMessages(messages, plans, writable, canSendOutline = false) {
    const plansBySource = new Map();
    for (const plan of plans) {
        if (!plan.sourceMessageId) continue;
        if (!plansBySource.has(plan.sourceMessageId)) plansBySource.set(plan.sourceMessageId, []);
        plansBySource.get(plan.sourceMessageId).push(plan);
    }
    return messages.map((message, index) => {
        const assistant = message.role === 'assistant';
        const parsedPlans = assistant ? parseStoryPlans(message.content) : null;
        const parsedUser = assistant ? parseUserGenerationResponse(message.content) : null;
        const content = parsedUser?.hadBlocks
            ? parsedUser.displayText : parsedPlans?.plans?.length ? stripStoryPlanMarkup(message.content) : message.content;
        const bubbles = assistant ? splitMarkdownBubbles(content) : [String(content || '').trim()].filter(Boolean);
        const receipt = assistant ? renderReceipt(plansBySource.get(storyOracleMessageId(message)) || [], writable) : '';
        if (!bubbles.length && !receipt) return '';
        const bubbleMarkup = bubbles.map(bubble => `<div class="pm-bubble">${assistant ? renderSafeMarkdown(bubble) : renderBoldText(bubble).replace(/\n/g, '<br>')}</div>`).join('');
        // 回复里有大纲 YAML 时可以一键送进当前聊天项目的大纲草稿。
        const outline = assistant && canSendOutline && hasYamlBlock(message.content) ? `<button type="button" class="pm-story-oracle-link pm-story-oracle-to-outline" data-story-oracle-action="to-outline" data-story-oracle-message="${index}">送到大纲</button>` : '';
        return `<div class="pm-story-oracle-message ${assistant ? 'is-assistant' : 'is-user'}">${bubbleMarkup}${receipt}${outline}</div>`;
    }).filter(Boolean).join('');
}

// 发出去还没回来的问题（显示打字中），以及没收到回复的问题（可重新发送）。
function renderPendingTurn(vm) {
    if (vm.inflight) {
        return `<div class="pm-story-oracle-message is-user"><div class="pm-bubble">${renderBoldText(vm.inflight).replace(/\n/g, '<br>')}</div></div><div class="pm-bubble pm-left pm-typing-bubble" aria-label="AI 正在回复"><span></span><span></span><span></span></div>`;
    }
    if (!vm.failedTurn) return '';
    return `<div class="pm-story-oracle-message is-user is-failed"><div class="pm-bubble">${renderBoldText(vm.failedTurn.question).replace(/\n/g, '<br>')}</div>
      <div class="pm-story-oracle-retry"><span>${escapeHtml(vm.failedTurn.reason || '没有收到回复')}</span><button type="button" class="pm-story-oracle-link" data-story-oracle-action="resend" ${disabledAttr(vm.valid && vm.writable)}>${REFRESH_ICON_SVG}<span>重新发送</span></button></div></div>`;
}

function renderConversation(vm) {
    const userMode = vm.mode === 'user-generation';
    const pending = userMode && vm.pendingUser ? renderUserCard(vm.pendingUser, vm.userWritable, true) : '';
    const header = `<header class="pm-story-oracle-header is-sub">${renderBackButton()}<div class="pm-name-wrap"><button type="button" class="pm-name-trigger pm-story-oracle-mode-trigger" data-story-oracle-action="toggle-mode" aria-haspopup="menu" aria-expanded="${vm.modeSheetOpen}" aria-controls="pm-story-oracle-mode-menu" title="切换模式"><span class="pm-name">${MODE_LABELS[vm.mode]}</span><span class="pm-name-chevron" aria-hidden="true">${CHEVRON_DOWN_ICON_SVG}</span></button></div><span class="pm-story-oracle-icon-spacer" aria-hidden="true"></span></header>`;
    const bookLabel = vm.availableBookNames.length ? `${vm.selectedBookNames.length} 本世界书` : '没有可读世界书';
    const enabled = vm.valid && vm.writable;
    const body = `${userMode ? renderLibraryHint(vm) : ''}<div id="pm-story-oracle-conversation" class="pm-msg-list pm-story-oracle-message-list" data-story-oracle-scroll aria-live="polite">${renderMessages(vm.messages, vm.plans, vm.writable, Boolean(vm.plotProjectName))}${renderPendingTurn(vm)}${pending}</div>`;
    // 剧情聊天、剧情参谋讨论时附带当前聊天项目的设定与大纲，点标签可以关掉。
    const plotChip = !userMode && vm.plotProjectName ? `<button type="button" class="pm-story-oracle-chip${vm.plotContextOn ? '' : ' is-off'}" data-story-oracle-action="toggle-plot-context" aria-pressed="${vm.plotContextOn}" title="${vm.plotContextOn ? '点一下不再附带' : '点一下附带'}">${ROUTE_ICON_SVG}<span>${vm.plotContextOn ? '附带' : '不附带'}${escapeHtml(vm.plotProjectName)}的设定与大纲</span></button>` : '';
    // 回复中发送键变成 ×，点了停止；停下来的回复不保存，问题留着可以重新发送。
    const sendButton = vm.busy
        ? `<button type="button" class="pm-story-oracle-stop" data-story-oracle-action="cancel" title="停止回复" aria-label="停止回复">${CLOSE_ICON_SVG}</button>`
        : `<button type="submit" class="pm-up-btn" title="发送" aria-label="发送" ${disabledAttr(enabled)}>${SEND_ICON_SVG}</button>`;
    const footer = `<form class="pm-input-bar pm-story-oracle-composer" data-story-oracle-form>
      <div class="pm-story-oracle-chips"><button type="button" class="pm-story-oracle-chip" data-story-oracle-action="view" data-story-oracle-view="settings" title="调整阅读范围">${BOOK_ICON_SVG}<span>${bookLabel}</span></button>${plotChip}</div>
      <div class="pm-story-oracle-composer-row"><textarea class="pm-input" name="question" rows="2" maxlength="${MAX_QUESTION_CHARS}" placeholder="${vm.busy ? 'AI正在回复…' : MODE_PLACEHOLDERS[vm.mode]}" ${disabledAttr(enabled && !vm.busy)}>${escapeHtml(vm.draft)}</textarea>${sendButton}</div>
    </form>`;
    return { header, body, footer };
}

function renderLibraryHint(vm) {
    return vm.userWritable ? '' : `<p class="pm-story-oracle-library-hint">User库当前只读：${escapeHtml(vm.userReadOnlyReason || '数据无法安全写入')}。仍可生成和复制。</p>`;
}

// User 成品卡：右上只放「复制」，点卡片进详情；未保存的成品用主题浅色块并带保存按钮。
function renderUserCard(item, writable, pending = false) {
    const id = pending ? 'pending' : item.id;
    return `<article class="pm-story-oracle-card pm-story-oracle-user-card${pending ? ' is-featured is-pending' : ''}" data-story-oracle-user-id="${escapeAttr(id)}">
      <div class="pm-story-oracle-card-head"><span class="pm-story-oracle-seal" aria-hidden="true">${escapeHtml(pending ? '新' : firstChar(item.title) || 'U')}</span><button type="button" class="pm-story-oracle-card-body" data-story-oracle-action="open-user" data-story-oracle-user-id="${escapeAttr(id)}"><b>${escapeHtml(item.title)}</b>${item.summary ? `<span class="pm-story-oracle-card-text">${escapeHtml(item.summary)}</span>` : ''}</button><button type="button" class="pm-story-oracle-user-copy" data-story-oracle-action="copy-user" data-story-oracle-user-id="${escapeAttr(id)}" aria-label="复制 ${escapeAttr(item.title)}" title="复制">复制</button></div>
      ${pending ? `<button type="button" class="pm-action-button is-accent pm-story-oracle-user-save" data-story-oracle-action="save-user" data-story-oracle-user-id="pending" ${disabledAttr(writable)}>保存到User库</button>` : `<div class="pm-story-oracle-card-meta"><span>${formatDate(item.updatedAt || item.createdAt)}</span><span>${formatChars(item.content)}</span></div>`}
    </article>`;
}
function renderUsers(vm) {
    // User库不在底栏：从首页磁贴进，右上「生成新的」进User生成对话。
    const create = `<button type="button" class="pm-story-oracle-icon-button" data-story-oracle-action="open-conversation" data-story-oracle-mode="user-generation" aria-label="生成新的User" title="生成新的User">${SPARKLES_ICON_SVG}</button>`;
    const header = `<header class="pm-story-oracle-header"><div class="pm-story-oracle-header-text"><h2>User库</h2><small>${vm.userItems.length} 个</small></div>${create}</header>`;
    const cards = [
        vm.pendingUser ? renderUserCard(vm.pendingUser, vm.userWritable, true) : '',
        ...vm.userItems.map(item => renderUserCard(item, vm.userWritable)),
    ].join('');
    const empty = '<p class="pm-story-oracle-empty">还没有User成品。</p>';
    return { header, body: `${renderLibraryHint(vm)}<div id="pm-story-oracle-users" class="pm-story-oracle-list">${cards || empty}</div>` };
}

function renderUserDetail(vm, item, pending) {
    const id = pending ? 'pending' : item.id;
    const menuItems = pending ? [] : [`<button type="button" class="pm-control-menu-danger" role="menuitem" data-story-oracle-action="delete-user" data-story-oracle-user-id="${escapeAttr(id)}" ${disabledAttr(vm.userWritable)}>${TRASH_ICON_SVG}<span>删除成品</span></button>`];
    const header = `<header class="pm-story-oracle-header is-sub">${renderBackButton()}<span></span>${renderMoreMenu(`user:${id}`, menuItems, vm.openMenuId === `user:${id}`)}</header>`;
    const body = `<article class="pm-story-oracle-detail" data-story-oracle-user-id="${escapeAttr(id)}">
      ${pending ? '<span class="pm-story-oracle-pill is-active">未保存</span>' : ''}<h2>${escapeHtml(item.title)}</h2>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}
      <div class="pm-story-oracle-card-meta"><span>${formatDate(item.updatedAt || item.createdAt)}</span><span>${formatChars(item.content)}</span></div>
      <div class="pm-story-oracle-user-content">${renderSafeMarkdown(item.content)}</div>
    </article>`;
    const footer = `<div class="pm-story-oracle-actions"><button type="button" class="pm-action-button is-secondary" data-story-oracle-action="copy-user" data-story-oracle-user-id="${escapeAttr(id)}">复制</button>${pending
        ? `<button type="button" class="pm-action-button is-accent" data-story-oracle-action="save-user" data-story-oracle-user-id="pending" ${disabledAttr(vm.userWritable)}>保存到User库</button>`
        : `<button type="button" class="pm-action-button is-accent" data-story-oracle-action="revise-user" data-story-oracle-user-id="${escapeAttr(id)}">继续修改</button>`}</div>`;
    return { header, body, footer };
}

function renderPlanDetail(vm, plan) {
    const controllable = storyOraclePlanIntensityControllable(plan);
    const menuItems = [`<button type="button" class="pm-control-menu-danger" role="menuitem" data-story-oracle-action="delete-plan" data-story-oracle-plan-id="${escapeAttr(plan.id)}" ${disabledAttr(vm.writable)}>${TRASH_ICON_SVG}<span>删除线路</span></button>`];
    const header = `<header class="pm-story-oracle-header is-sub">${renderBackButton()}<span></span>${renderMoreMenu(`plan:${plan.id}`, menuItems, vm.openMenuId === `plan:${plan.id}`)}</header>`;
    const intensity = Object.entries(STORY_ORACLE_INTENSITIES).map(([key, item]) => {
        const selected = controllable && plan.intensity === key;
        return `<button type="button" class="pm-story-oracle-segment${selected ? ' is-selected' : ''}" data-story-oracle-action="plan-intensity" data-story-oracle-plan-id="${escapeAttr(plan.id)}" data-story-oracle-intensity="${key}" data-story-oracle-available="${controllable}" aria-pressed="${selected}" ${disabledAttr(vm.writable && controllable)}>${item.label}</button>`;
    }).join('');
    const points = [[FLAG_ICON_SVG, '起始迹象', plan.seed], [LINK_ICON_SVG, '契合点', plan.why], [GAUGE_ICON_SVG, '建议节奏', plan.pace]]
        .filter(([, , value]) => value)
        .map(([icon, label, value]) => `<li><span class="pm-story-oracle-point-icon">${icon}</span><span class="pm-story-oracle-point-text"><small>${label}</small>${escapeHtml(value)}</span></li>`).join('');
    const body = `<article class="pm-story-oracle-detail" data-story-oracle-plan-id="${escapeAttr(plan.id)}">
      ${renderPlanPill(plan)}<h2>${escapeHtml(planTitle(plan))}</h2>${plan.goal && plan.goal !== plan.title ? `<p>${escapeHtml(plan.goal)}</p>` : ''}
      <section class="pm-story-oracle-field"><h3>推进强度</h3><div class="pm-story-oracle-segments" role="group" aria-label="推进强度">${intensity}</div>${controllable ? '' : '<p class="pm-story-oracle-note">「节奏：」行已手动改写，恢复默认后可切换。</p>'}</section>
      ${points ? `<section class="pm-story-oracle-field"><h3>路线要点</h3><ul class="pm-story-oracle-points">${points}</ul></section>` : ''}
      <section class="pm-story-oracle-field"><div class="pm-story-oracle-section-head"><h3>写入主聊天的引导</h3><button type="button" class="pm-story-oracle-link" data-story-oracle-action="edit-plan-injection" data-story-oracle-plan-id="${escapeAttr(plan.id)}" ${disabledAttr(vm.writable)}>编辑</button></div><p class="pm-story-oracle-quote">${escapeHtml(storyOraclePlanInjectionText(plan))}</p></section>
    </article>`;
    const footer = `<div class="pm-story-oracle-actions"><button type="button" class="pm-action-button is-secondary" data-story-oracle-action="continue-plan" data-story-oracle-plan-id="${escapeAttr(plan.id)}">继续讨论</button><button type="button" class="pm-action-button is-accent" data-story-oracle-action="toggle-plan" data-story-oracle-plan-id="${escapeAttr(plan.id)}" aria-pressed="${plan.enabled}" ${disabledAttr(vm.writable)}>${plan.enabled ? '停止引导' : '开始引导'}</button></div>`;
    return { header, body, footer };
}

function renderPlans(vm) {
    const sorted = newestFirst(vm.plans);
    const active = sorted.filter(plan => plan.enabled);
    const idle = sorted.filter(plan => !plan.enabled);
    const header = renderTopHeader('路线', `${active.length} 条引导中`);
    const tabs = `<div class="pm-story-oracle-tabs" role="tablist" aria-label="路线筛选">${[['active', '引导中', active.length], ['idle', '未启用', idle.length]].map(([key, label, count]) => `<button type="button" role="tab" class="pm-story-oracle-tab${vm.planFilter === key ? ' is-selected' : ''}" data-story-oracle-action="plan-filter" data-story-oracle-filter="${key}" aria-selected="${vm.planFilter === key}" aria-controls="pm-story-oracle-plans">${label}<span class="pm-story-oracle-tab-count">${count}</span></button>`).join('')}</div>`;
    const shown = vm.planFilter === 'idle' ? idle : active;
    const empty = vm.plans.length
        ? `<p class="pm-story-oracle-empty">${vm.planFilter === 'idle' ? '没有未启用的路线。' : '没有引导中的路线。'}</p>`
        : '<p class="pm-story-oracle-empty">还没有路线。</p>';
    const cards = shown.map((plan, index) => renderPlanCard(plan, vm.writable, vm.planFilter === 'active' && index === 0)).join('');
    return { header, body: `${tabs}<div id="pm-story-oracle-plans" class="pm-story-oracle-list" role="tabpanel">${cards || empty}</div>` };
}
// 首页：最上面是本聊天正在用的剧情项目（与检测提示），下面是各功能入口。路线在底栏「路线」。
function renderHome(vm) {
    const header = renderTopHeader('剧情助手', vm.subtitle, vm.seal);
    const activePlans = vm.plans.filter(plan => plan.enabled).length;
    const counts = {
        question: `${Math.ceil(vm.counts.question / 2)}轮对话`,
        advisor: activePlans ? `${activePlans}条路线引导中` : `${vm.plans.length}条路线`,
        'user-generation': `已存${vm.userItems.length}个`,
    };
    // User生成进 User库（库里有「生成新的」），另两种直接进对话。
    const tiles = STORY_ORACLE_MODES.map(mode => {
        const target = mode === 'user-generation' ? 'data-story-oracle-action="view" data-story-oracle-view="users"' : `data-story-oracle-action="open-conversation" data-story-oracle-mode="${mode}"`;
        return `<button type="button" class="pm-story-oracle-tile" ${target}><span class="pm-story-oracle-tile-icon${mode === vm.mode ? ' is-current' : ''}">${MODE_ICONS[mode]}</span><b>${MODE_LABELS[mode]}</b><small>${counts[mode]}</small></button>`;
    }).join('');
    const bookMeta = vm.availableBookNames.length ? `${vm.selectedBookNames.length}/${vm.availableBookNames.length}本` : '没有可读世界书';
    const bookTile = `<button type="button" class="pm-story-oracle-tile" data-story-oracle-action="view" data-story-oracle-view="prefs"><span class="pm-story-oracle-tile-icon">${BOOK_ICON_SVG}</span><b>阅读范围</b><small>${bookMeta}</small></button>`;
    const body = `${vm.plotHome || ''}${renderSectionHead('从这里开始')}<div class="pm-story-oracle-tiles">${tiles}${bookTile}</div>`;
    return { header, body };
}

// 设置首页：剧情检测、模型接口，其余收进「更多」。
function renderSettings(vm) {
    const header = renderTopHeader('设置', '剧情检测对所有聊天生效');
    const more = `<section class="pm-story-oracle-field">${renderSectionHead('更多')}<ul class="pm-story-oracle-group pm-plot-rows">
      <li><button type="button" class="pm-plot-row" data-story-oracle-action="view" data-story-oracle-view="prefs">${BOOK_ICON_SVG}<span class="pm-plot-row-text"><b>阅读范围、提示词、写作基准</b><small>以及清空记录、导入项目</small></span><span class="pm-plot-chevron" aria-hidden="true">${FORWARD_ICON_SVG}</span></button></li>
      <li><button type="button" class="pm-plot-row" data-plot-action="diagnose">${GAUGE_ICON_SVG}<span class="pm-plot-row-text"><b>诊断</b></span><span class="pm-plot-chevron" aria-hidden="true">${FORWARD_ICON_SVG}</span></button></li></ul></section>`;
    return { header, body: `${vm.plotSettings || ''}${more}` };
}

// 「更多」二级页：原设置页的阅读范围、系统提示词、清空，加上剧情注入器的写作基准与导入。
function renderPrefs(vm) {
    const header = `<header class="pm-story-oracle-header is-sub">${renderBackButton()}<b class="pm-plot-stage-volume">更多设置</b><span class="pm-story-oracle-icon-spacer" aria-hidden="true"></span></header>`;
    const selected = new Set(vm.selectedBookNames);
    const books = vm.availableBookNames.map(name => {
        const checked = selected.has(name);
        return `<li><span class="pm-story-oracle-row-icon">${BOOK_ICON_SVG}</span><span class="pm-story-oracle-row-label">${escapeHtml(name)}</span><button type="button" class="pm-custom-check${checked ? ' is-checked' : ''}" role="switch" aria-checked="${checked}" aria-label="阅读 ${escapeAttr(name)}" data-story-oracle-action="toggle-world-book" data-story-oracle-book="${escapeAttr(name)}" ${disabledAttr(vm.valid && vm.writable)}></button></li>`;
    }).join('');
    const allSelected = vm.availableBookNames.every(name => selected.has(name));
    const selectAll = vm.availableBookNames.length ? `<button type="button" class="pm-story-oracle-link" data-story-oracle-action="select-all-world-books" data-story-oracle-available="${!allSelected}" ${disabledAttr(vm.valid && vm.writable && !allSelected)}>全选</button>` : '';
    const clearPlans = `<li><button type="button" class="pm-story-oracle-danger-row" data-story-oracle-action="clear-plans" data-story-oracle-available="${vm.plans.length > 0}" ${disabledAttr(vm.writable && vm.plans.length > 0)}>${ROUTE_ICON_SVG}<span>清空路线</span><small>${vm.plans.length} 条</small></button></li>`;
    const clearModes = STORY_ORACLE_MODES.map(mode => {
        const count = vm.counts[mode];
        return `<li><button type="button" class="pm-story-oracle-danger-row" data-story-oracle-action="clear" data-story-oracle-mode="${mode}" data-story-oracle-available="${count > 0}" ${disabledAttr(vm.writable && count > 0)}>${TRASH_ICON_SVG}<span>${CLEAR_LABELS[mode]}</span><small>${count} 条</small></button></li>`;
    }).join('');
    const body = `<section class="pm-story-oracle-field">${renderSectionHead('阅读范围', selectAll)}${books ? `<ul class="pm-story-oracle-group" aria-label="世界书">${books}</ul>` : '<p class="pm-story-oracle-empty is-inline">没有可读世界书</p>'}</section>
      <section class="pm-story-oracle-field">${renderSectionHead('系统提示词', `<button type="button" class="pm-story-oracle-link" data-story-oracle-action="settings" ${disabledAttr(vm.valid && vm.writable)}>编辑</button>`)}<p class="pm-story-oracle-quote">${escapeHtml(vm.systemPrompt)}</p></section>
      ${vm.plotPrefs || ''}
      <section class="pm-story-oracle-field">${renderSectionHead('数据')}<ul class="pm-story-oracle-group">${clearPlans}${clearModes}</ul></section>`;
    return { header, body };
}

// 底栏：首页 / 剧情 / 中间对话键 / 路线 / 设置。User库从首页磁贴进。
function renderTabbar(view) {
    const item = (target, icon, label) => `<button type="button" class="pm-story-oracle-tabbar-item${view === target ? ' is-selected' : ''}" data-story-oracle-action="view" data-story-oracle-view="${target}" ${view === target ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></button>`;
    return `<nav class="pm-story-oracle-tabbar" aria-label="剧情助手">${item('home', GRID_ICON_SVG, '首页')}${item('plot', BOOK_ICON_SVG, '剧情')}<button type="button" class="pm-story-oracle-fab" data-story-oracle-action="open-conversation" aria-label="继续对话" title="继续对话">${SPARKLES_ICON_SVG}</button>${item('plans', ROUTE_ICON_SVG, '路线')}${item('settings', SETTINGS_ICON_SVG, '设置')}</nav>`;
}

const VIEW_RENDERERS = Object.freeze({
    home: renderHome, plans: renderPlans, users: renderUsers, settings: renderSettings, conversation: renderConversation, prefs: renderPrefs,
    plot: vm => vm.plotPage || { header: renderTopHeader('剧情', ''), body: '' },
    stage: vm => vm.plotStage || { header: renderTopHeader('剧情', ''), body: '' },
    plan: vm => renderPlanDetail(vm, vm.detailPlan),
    user: vm => renderUserDetail(vm, vm.detailUser, vm.detailUserPending),
});

export function renderStoryOracleShell(vm) {
    const { header, body, footer = '' } = VIEW_RENDERERS[vm.view](vm);
    const status = vm.statusText ? `<p class="pm-story-oracle-status" role="status">${escapeHtml(vm.statusText)}</p>` : '';
    const content = vm.view === 'conversation' ? body : `<div class="pm-story-oracle-scroll" data-story-oracle-scroll>${body}</div>`;
    const bottom = TOP_VIEWS.includes(vm.view) ? renderTabbar(vm.view) : footer;
    return `<div class="pm-story-oracle-shell" data-story-oracle-page="${vm.view}">${header}${status}${content}${bottom}${vm.view === 'conversation' ? renderModeSheet(vm.mode, vm.modeSheetOpen) : ''}${vm.plotSheet || ''}</div>`;
}
