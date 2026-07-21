import { BACK_ICON_SVG, CLOSE_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

export function renderSettingsHome() {
    return `
    <div class="pm-settings-home" role="list">
      <button type="button" role="listitem" onclick="window.__pmShowConfig('api')"><b>API</b><span>默认使用酒馆 API 预设</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('quick-reply')"><b>手机开关</b><span>创建或清除开关入口</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('look')"><b>主题</b><span>日夜模式、气泡颜色与背景图</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('backup')"><b>备份</b><span>导出、导入或安全清理插件数据</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('budget')"><b>上下文预算</b><span>控制手机会话与社区写入主提示词的额度</span></button>
      <div class="pm-global-setting" role="group" aria-labelledby="pm-wordy-label">
        <span><b id="pm-wordy-label">全局短消息限制</b><small>除话痨人设外，每条独立消息不超过 35 字</small></span>
        <div id="pm-wordy-check" onclick="window.__pmToggleWordyLimit()"
          class="pm-custom-check ${window.__pmWordyLimit === true ? 'is-checked' : ''}" role="checkbox" tabindex="0"
          aria-checked="${window.__pmWordyLimit === true}"
          onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
      </div>
    </div>`;
}

export function renderApiSettings({ cfg, useIndependent, profilesHtml }) {
    return `
    <div class="pm-settings-page">
      <div style="padding:12px 14px 6px;">
        <div class="pm-cfg-label" style="margin-bottom:6px;">API 模式</div>
        <div class="pm-mode-switch">
          <div id="pm-mode-main" class="pm-mode-opt ${!useIndependent ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(false)">主 API</div>
          <div id="pm-mode-indep" class="pm-mode-opt ${useIndependent ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(true)">独立 API</div>
        </div>
        <div id="pm-mode-tip" class="pm-cfg-tip" style="text-align:left;padding:6px 2px 0;">${useIndependent ? '独立 API 必须填写地址、密钥和模型' : '默认使用酒馆 API 预设'}</div>
      </div>
      <div id="pm-indep-profile-fields" class="pm-independent-api-fields" ${useIndependent ? '' : 'hidden'} style="padding:6px 14px 4px;border-top:1px solid var(--pm-color-border-subtle);">
        <div class="pm-cfg-label" style="margin:8px 0 6px;">已保存档案</div>
        <div class="pm-prof-list">${profilesHtml}</div>
      </div>
      <div id="pm-indep-config-fields" class="pm-independent-api-fields" ${useIndependent ? '' : 'hidden'} style="padding:10px 16px;display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--pm-color-border-subtle);">
        <div class="pm-cfg-label">API 地址</div>
        <input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.xxx.com 或 .../v1" value="${cfg.apiUrl}">
        <div class="pm-cfg-label">API Key</div>
        <input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." value="${cfg.apiKey}" maxlength="999">
        <div class="pm-cfg-label">模型名称</div>
        <div class="pm-model-row">
          <input id="pm-cfg-model" class="pm-cfg-input" placeholder="独立 API 必填：手动输入或选择" value="${cfg.model}">
          <button id="pm-model-arrow" type="button" aria-label="选择模型" onclick="window.__pmShowModelPicker()">▼</button>
        </div>
        <label class="pm-cfg-label" for="pm-cfg-temperature">温度</label>
        <input id="pm-cfg-temperature" class="pm-cfg-input" type="number" min="0" max="2" step="0.1" inputmode="decimal" value="${cfg.temperature}">
        <div class="pm-cfg-help">范围 0–2；数值越高，回复越随机。默认 1.2。</div>
        <div id="pm-api-status" class="pm-cfg-tip" style="font-weight:bold;">测试连接不会覆盖当前配置，点击保存后生效</div>
        <div class="pm-action-row">
          <button class="pm-action-button is-model-fetch" onclick="window.__pmTestApi()">拉取模型</button>
          <button class="pm-action-button is-api-test" onclick="window.__pmTestModel()">测试 API</button>
        </div>
      </div>
      <div style="height:12px;"></div>
    </div>`;
}

export function renderQuickReplySettings(status, label = '天音') {
    const safeLabel = escapeHtml(label);
    const labelValue = escapeAttr(label);
    const descriptions = {
        ready: `手机开关入口已创建并启用，点击“${safeLabel}”即可打开手机。`,
        repairable: '检测到手机开关入口，但配置或启用状态需要修复。',
        conflict: '存在同名集合，但无法证明属于天音小笺。为保护用户数据，禁止覆盖。',
        absent: '尚未创建手机开关入口。',
        unavailable: status.error || '当前宿主未提供可用的 Quick Reply API。',
    };
    return `<div class="pm-settings-page pm-quick-reply-settings">
      <section><b>手机开关</b><p>入口会执行 <code>/phone</code>。名称最多 6 个字，留空时使用“天音”。</p>
        <label class="pm-quick-reply-label"><span>入口名称</span><input id="pm-quick-reply-label" class="pm-cfg-input" maxlength="6" value="${labelValue}" autocomplete="off"></label>
      </section>
      <div id="pm-quick-reply-status" class="pm-cfg-tip" data-state="${status.state}" role="status">${descriptions[status.state] || descriptions.unavailable}</div>
      <div class="pm-quick-reply-actions">
        <button type="button" onclick="window.__pmEnsurePhoneQuickReply()">${status.state === 'ready' ? '保存并修复' : '创建快捷回复'}</button>
        <button type="button" class="is-danger" onclick="window.__pmClearPhoneQuickReply()" ${status.state === 'absent' || status.state === 'unavailable' ? 'disabled' : ''}>清除快捷回复</button>
      </div>
    </div>`;
}


export function renderLookSettings({ theme, presetButtons, desktopBackgroundButtons, globalBackgroundButtons, localBackgroundButtons }) {
    return `
    <div class="pm-settings-page">
      <div style="padding:12px 16px;">
        <div class="pm-cfg-label" style="margin-bottom:8px;">日夜模式</div>
        <div class="pm-theme-row" style="margin-bottom:8px;">
          <div class="pm-layout-chip ${theme.darkMode === 'light' ? 'pm-layout-active' : ''}" onclick="window.__pmSetDarkMode('light')">日间</div>
          <div class="pm-layout-chip ${theme.darkMode === 'dark' ? 'pm-layout-active' : ''}" onclick="window.__pmSetDarkMode('dark')">夜间</div>
        </div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid var(--pm-color-border-subtle);">
        <label class="pm-cfg-label pm-ambient-setting">
          <span><b>显示本地状态栏</b><small>仅显示设备本地时间。</small></span>
          <div id="pm-ambient-status-enabled" class="pm-custom-check ${theme.ambientStatusEnabled === true ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${theme.ambientStatusEnabled === true}" onclick="const enabled=!this.classList.contains('is-checked');this.classList.toggle('is-checked',enabled);this.setAttribute('aria-checked',String(enabled));window.__pmSetAmbientStatus(enabled)" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>
      </div>
      <div style="padding:12px 16px;border-top:1px solid var(--pm-color-border-subtle);">
        <label class="pm-cfg-label" for="pm-custom-title">桌面标题</label>
        <input id="pm-custom-title" class="pm-cfg-input" maxlength="20" value="${String(theme.customTitle || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}" placeholder="天音小笺" oninput="window.__pmSetCustomTitle()">
        <small class="pm-cfg-help">留空时显示“天音小笺”。</small>
      </div>
      <div style="padding:14px 16px 12px;border-top:1px solid var(--pm-color-border-subtle);">
        <div class="pm-cfg-label" style="margin-bottom:10px;">气泡主题</div>
        <div class="pm-theme-row">${presetButtons}</div>
        <div style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap;">
          <label class="pm-cfg-label" style="margin:0;">自定义右</label>
          <input id="pm-custom-right" type="color" value="${theme.customRight || '#007aff'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <label class="pm-cfg-label" style="margin:0;">自定义左</label>
          <input id="pm-custom-left" type="color" value="${theme.customLeft || '#e9e9eb'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <button type="button" onclick="window.__pmClearCustomColor()" class="pm-color-clear">重置</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center;">
          <label class="pm-cfg-label" style="margin:0;">边框颜色</label>
          <input id="pm-border-color" type="color" value="${theme.borderColor || '#1a1a1a'}" onchange="window.__pmSetBorderColor()" class="pm-color-pick">
          <button type="button" onclick="document.getElementById('pm-border-color').value='#1a1a1a';window.__pmSetBorderColor()" class="pm-color-clear">重置</button>
        </div>
      </div>
      <div style="padding:12px 16px 12px;border-top:1px solid var(--pm-color-border-subtle);">
        <div class="pm-cfg-label" style="margin-bottom:14px;">背景图</div>
        <div style="display:flex;flex-direction:column;gap:14px;padding:0 4px;">
          <div class="pm-bg-row"><span class="pm-bg-label">桌面背景</span>${desktopBackgroundButtons}</div>
          <div class="pm-bg-row"><span class="pm-bg-label">全局背景</span>${globalBackgroundButtons}</div>
          <div class="pm-bg-row"><span class="pm-bg-label">本联系人</span>${localBackgroundButtons}</div>
        </div>
      </div>
      <div style="height:12px;"></div>
    </div>`;
}

export function getBudgetPercentageView(sourceWeights) {
    const weights = {
        phone: Number(sourceWeights?.phone) || 0,
        community: Number(sourceWeights?.community) || 0,
        calendar: Number(sourceWeights?.calendar) || 0,
    };
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (total <= 0) return { phone: 100, community: 0, calendar: 0 };
    const phone = Number((weights.phone * 100 / total).toFixed(4));
    const community = Number((weights.community * 100 / total).toFixed(4));
    return { phone, community, calendar: Number((100 - phone - community).toFixed(4)) };
}

export function resolveBudgetPercentageInput({
    sourceWeights, phone, community, calendar, initialPhone, initialCommunity, initialCalendar,
}) {
    const next = { phone: Number(phone), community: Number(community), calendar: Number(calendar) };
    const initial = { phone: Number(initialPhone), community: Number(initialCommunity), calendar: Number(initialCalendar) };
    if (Object.keys(next).every(source => next[source] === initial[source])) {
        return { phone: sourceWeights.phone, community: sourceWeights.community, calendar: sourceWeights.calendar || 0 };
    }
    if (!Object.values(next).every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
        throw new Error('手机会话、互动社区和日历占比必须是 0 到 100 之间的数字');
    }
    if (Math.abs(next.phone + next.community + next.calendar - 100) > 0.0001) {
        throw new Error('手机会话、互动社区和日历占比合计必须为 100%');
    }
    return next;
}

export function renderBudgetSceneOptions({ config, scope, storageId }) {
    const allowed = new Set(config.communitySceneIdsByStorage[storageId] || []);
    const storedSelections = config.communitySelectionsByStorage[storageId] || {};
    if (!Array.isArray(scope?.sceneOrder)) return '';
    return scope.sceneOrder.flatMap(sceneId => {
        const scene = scope.scenes?.[sceneId];
        if (!scene) return [];
        const selection = storedSelections[sceneId]?.mode === 'selected'
            ? storedSelections[sceneId] : { mode: 'all', postIds: [] };
        const postIds = new Set(selection.postIds || []);
        const posts = Array.isArray(scene.posts) ? scene.posts.map(post => `
          <label class="pm-budget-post-option">
            <input type="checkbox" class="pm-budget-post" data-scene-id="${escapeAttr(sceneId)}" value="${escapeAttr(post.id)}" ${postIds.has(post.id) ? 'checked' : ''}>
            <span>${escapeHtml(post.content || '无正文帖子')}</span>
          </label>`).join('') : '';
        return [`<section class="pm-budget-scene-card ${selection.mode === 'selected' ? 'is-selected-mode' : ''}" data-scene-id="${escapeAttr(sceneId)}">
          <label class="pm-cfg-label pm-check-setting"><span>${escapeHtml(scene.title)}</span><div class="pm-custom-check pm-budget-scene ${allowed.has(sceneId) ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${allowed.has(sceneId)}" data-value="${escapeAttr(sceneId)}" onclick="this.classList.toggle('is-checked');this.setAttribute('aria-checked',String(this.classList.contains('is-checked')))" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div></label>
          <label class="pm-cfg-label">帖子注入范围
            <select class="pm-cfg-input pm-budget-selection-mode" data-scene-id="${escapeAttr(sceneId)}" onchange="this.closest('.pm-budget-scene-card').classList.toggle('is-selected-mode',this.value==='selected')">
              <option value="all" ${selection.mode === 'all' ? 'selected' : ''}>全部帖子</option>
              <option value="selected" ${selection.mode === 'selected' ? 'selected' : ''}>仅选中帖子</option>
            </select>
          </label>
          <div class="pm-budget-post-list">${posts || '<div class="pm-cfg-tip">当前场景没有帖子</div>'}</div>
        </section>`];
    }).join('');
}

export function collectBudgetCommunityFields(root, current, storageId) {
    const sceneIds = Array.from(root.querySelectorAll('.pm-budget-scene.is-checked'))
        .map(control => control.dataset.value).filter(Boolean);
    const communitySceneIdsByStorage = { ...current.communitySceneIdsByStorage };
    const communitySelectionsByStorage = { ...current.communitySelectionsByStorage };
    if (!storageId || storageId === 'sms_unknown__default') {
        return { communitySceneIdsByStorage, communitySelectionsByStorage };
    }
    if (sceneIds.length) communitySceneIdsByStorage[storageId] = sceneIds;
    else delete communitySceneIdsByStorage[storageId];
    const sceneSelections = {};
    root.querySelectorAll('.pm-budget-selection-mode').forEach(control => {
        const sceneId = control.dataset.sceneId;
        if (!sceneId) return;
        const postIds = Array.from(root.querySelectorAll('.pm-budget-post:checked'))
            .filter(input => input.dataset.sceneId === sceneId).map(input => input.value).filter(Boolean);
        sceneSelections[sceneId] = control.value === 'selected'
            ? { mode: 'selected', postIds } : { mode: 'all', postIds: [] };
    });
    if (Object.keys(sceneSelections).length) communitySelectionsByStorage[storageId] = sceneSelections;
    else delete communitySelectionsByStorage[storageId];
    return { communitySceneIdsByStorage, communitySelectionsByStorage };
}

export function renderBudgetSettings({ config, sceneOptions }) {
    const priority = config.sourcePriority[0];
    const percentages = getBudgetPercentageView(config.sourceWeights);
    return `
    <div class="pm-settings-page">
      <div style="padding:12px 16px;display:flex;flex-direction:column;gap:10px;">
        <div class="pm-cfg-label">上下文预算</div>
        <div class="pm-cfg-tip" style="text-align:left;">控制本插件写入主提示词的内容量，不限制模型输出。</div>
        <label class="pm-cfg-label" for="pm-budget-target">总目标（估算 token）</label>
        <input id="pm-budget-target" class="pm-cfg-input" type="number" min="1" max="12000" step="1" value="${config.targetTokens}">
        <div class="pm-cfg-tip" style="text-align:left;">数值越大，AI 能看到的手机和社区历史越多，也会占用更多上下文。</div>
        <div class="pm-budget-weight-list">
          <label class="pm-cfg-label">手机会话占比 (%)<input id="pm-budget-phone-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.phone}" data-initial-value="${percentages.phone}"></label>
          <label class="pm-cfg-label">互动社区占比 (%)<input id="pm-budget-community-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.community}" data-initial-value="${percentages.community}"></label>
          <label class="pm-cfg-label">日历占比 (%)<input id="pm-budget-calendar-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.calendar}" data-initial-value="${percentages.calendar}"></label>
        </div>
        <div class="pm-cfg-tip" style="text-align:left;">三类内容占比合计必须为 100%。日历注入默认关闭，且只包含普通日程。</div>
        <label class="pm-cfg-label" for="pm-budget-priority">剩余额度优先补给</label>
        <select id="pm-budget-priority" class="pm-cfg-input">
          <option value="phone" ${priority === 'phone' ? 'selected' : ''}>手机会话优先</option>
          <option value="community" ${priority === 'community' ? 'selected' : ''}>互动社区优先</option>
          <option value="calendar" ${priority === 'calendar' ? 'selected' : ''}>日历优先</option>
        </select>
        <label class="pm-cfg-label pm-check-setting">
          <span>把一方没用完的额度补给另一方</span>
          <div id="pm-budget-redistribute" class="pm-custom-check ${config.redistributeUnused ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${config.redistributeUnused}" onclick="this.classList.toggle('is-checked');this.setAttribute('aria-checked',String(this.classList.contains('is-checked')))" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>
      </div>
      <div style="padding:12px 16px;border-top:1px solid var(--pm-color-border-subtle);display:flex;flex-direction:column;gap:10px;">
        <label class="pm-cfg-label pm-check-setting">
          <span>启用互动社区注入（默认关闭）</span>
          <div id="pm-budget-community-enabled" class="pm-custom-check ${config.communityEnabled ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${config.communityEnabled}" onclick="this.classList.toggle('is-checked');this.setAttribute('aria-checked',String(this.classList.contains('is-checked')))" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>
        <label class="pm-cfg-label" for="pm-budget-community-position">社区注入位置</label>
        <select id="pm-budget-community-position" class="pm-cfg-input">
          <option value="0" ${config.communityPosition === 0 ? 'selected' : ''}>主提示词内</option>
          <option value="1" ${config.communityPosition === 1 ? 'selected' : ''}>聊天记录内</option>
          <option value="2" ${config.communityPosition === 2 ? 'selected' : ''}>主提示词前</option>
        </select>
        <label class="pm-cfg-label" for="pm-budget-community-depth">社区注入深度</label>
        <input id="pm-budget-community-depth" class="pm-cfg-input" type="number" min="0" max="10000" step="1" value="${config.communityDepth}">
        <div class="pm-cfg-label">当前角色卡允许注入的场景</div>
        <div id="pm-budget-scenes" style="display:flex;flex-direction:column;gap:6px;">${sceneOptions || '<div class="pm-cfg-tip" style="text-align:left;">当前没有可选择的互动场景</div>'}</div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid var(--pm-color-border-subtle);display:flex;flex-direction:column;gap:10px;">
        <label class="pm-cfg-label pm-check-setting">
          <span>启用生活日历注入（默认关闭）</span>
          <div id="pm-budget-calendar-enabled" class="pm-custom-check ${config.calendarEnabled ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${config.calendarEnabled}" onclick="this.classList.toggle('is-checked');this.setAttribute('aria-checked',String(this.classList.contains('is-checked')))" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>
        <div class="pm-cfg-tip" style="text-align:left;color:#ff9500;">注入当前角色/聊天未来七天的日程、生日与纪念日、节假日、天气和生理周期，让角色保有连续的生活安排。</div>
        <label class="pm-cfg-label" for="pm-budget-calendar-position">日历注入位置</label>
        <select id="pm-budget-calendar-position" class="pm-cfg-input">
          <option value="0" ${config.calendarPosition === 0 ? 'selected' : ''}>主提示词内</option>
          <option value="1" ${config.calendarPosition === 1 ? 'selected' : ''}>聊天记录内</option>
          <option value="2" ${config.calendarPosition === 2 ? 'selected' : ''}>主提示词前</option>
        </select>
        <label class="pm-cfg-label" for="pm-budget-calendar-depth">日历注入深度</label>
        <input id="pm-budget-calendar-depth" class="pm-cfg-input" type="number" min="0" max="10000" step="1" value="${config.calendarDepth}">
      </div>
      <div style="height:12px;"></div>
    </div>`;
}



export function renderBackupSettings() {
    return `
    <div class="pm-settings-page">
      <div style="padding:12px 16px 12px;border-top:1px solid var(--pm-color-border-subtle);">
        <div class="pm-cfg-label" style="margin-bottom:10px;">数据备份</div>
        <div class="pm-action-row">
          <button class="pm-action-button is-success" onclick="window.__pmExportData()">导出备份</button>
          <button class="pm-action-button is-accent" onclick="document.getElementById('pm-import-file').click()">导入备份</button>
          <input id="pm-import-file" type="file" accept=".json" onchange="window.__pmImportData(this)" hidden>
        </div>
        <div class="pm-cfg-tip" style="text-align:left;margin-top:6px;color:#ff9500;">注意：导入会覆盖当前所有联系人、记录、社区与页面恢复状态</div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid var(--pm-color-border-subtle);">
        <div class="pm-cfg-label" style="margin-bottom:6px;color:#ff3b30;">应用内安全清理</div>
        <div class="pm-cfg-tip" style="text-align:left;margin-bottom:8px;">仅删除天音小笺拥有的数据，不触碰宿主或其他扩展。建议先导出备份。</div>
        <button type="button" class="pm-action-button is-danger" onclick="window.__pmClearAllData()" style="width:100%">清理全部天音小笺数据</button>
      </div>
      <div style="height:12px;"></div>
    </div>`;
}

export function renderSettingsModal({ title, content, footer = '', showBack = true }) {
    return `
<div class="pm-modal pm-modal-wide" style="height: 560px;">
  <div class="pm-modal-header"><span>${showBack ? `<button type="button" onclick="window.__pmShowConfig('home')" class="pm-modal-close" title="返回设置" aria-label="返回设置">${BACK_ICON_SVG}</button>` : ''}</span><b>${title}</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll">${content}</div>
  ${footer}
</div>`;
}
