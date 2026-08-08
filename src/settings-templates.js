import { BACK_ICON_SVG, CLOSE_ICON_SVG } from './icons.js';
import { THEME_PRESETS } from './config.js';
import { escapeAttr, escapeHtml } from './ui.js';

export function renderSettingsHome() {
    return `
    <div class="pm-settings-home" role="list">
      <button type="button" role="listitem" onclick="window.__pmShowConfig('api')"><b>API</b><span class="pm-settings-home-hint">默认使用酒馆 API 预设</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('quick-reply')"><b>手机开关</b><span class="pm-settings-home-hint">创建或清除开关入口</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('look')"><b>主题</b><span class="pm-settings-home-hint">日夜模式、气泡颜色与背景图</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('backup')"><b>备份</b><span class="pm-settings-home-hint">导出、导入或安全清理插件数据</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('worldbook')"><b>世界书读取</b><span class="pm-settings-home-hint">包括数据库条目在内，控制手机读取的世界书条目</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('budget')"><b>上下文预算</b><span class="pm-settings-home-hint">控制手机会话与社区写入主提示词的额度</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConversationInjection()"><b>正文注入</b><span class="pm-settings-home-hint">分别设置聊天、社区、日历与菜谱的注入位置和深度</span></button>
      <div class="pm-global-setting" role="group" aria-labelledby="pm-wordy-label">
        <span><b id="pm-wordy-label">全局短消息限制</b><span class="pm-settings-home-hint">除话痨人设外，每条消息不超过 35 字</span></span>
        <div id="pm-wordy-check" onclick="window.__pmToggleWordyLimit()"
          class="pm-custom-check ${window.__pmWordyLimit === true ? 'is-checked' : ''}" role="checkbox" tabindex="0"
          aria-checked="${window.__pmWordyLimit === true}"
          onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
      </div>
      <div class="pm-global-setting" role="group" aria-labelledby="pm-gal-bubble-label">
        <span><b id="pm-gal-bubble-label">GAL 气泡正则</b><span class="pm-settings-home-hint">写入酒馆全局正则，并要求手机回复使用 GAL 台词格式</span></span>
        <div id="pm-gal-bubble-check" onclick="window.__pmToggleGalBubble()"
          class="pm-custom-check ${window.__pmGalBubbleOperational === true ? 'is-checked' : ''}" role="checkbox" tabindex="0"
          aria-checked="${window.__pmGalBubbleOperational === true}"
          onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
      </div>
    </div>`;
}

export function renderApiSettings({ cfg, useIndependent, profilesHtml }) {
    return `
    <div class="pm-settings-page">
      <div class="pm-settings-section">
        <div class="pm-cfg-label">API 模式</div>
        <div class="pm-mode-switch">
          <div id="pm-mode-main" class="pm-mode-opt ${!useIndependent ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(false)">主 API</div>
          <div id="pm-mode-indep" class="pm-mode-opt ${useIndependent ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(true)">独立 API</div>
        </div>
        <div id="pm-mode-tip" class="pm-cfg-tip">${useIndependent ? '独立 API 必须填写地址、密钥和模型' : '默认使用酒馆 API 预设'}</div>
      </div>
      <div id="pm-indep-profile-fields" class="pm-independent-api-fields pm-settings-section" ${useIndependent ? '' : 'hidden'}>
        <div class="pm-cfg-label">已保存档案</div>
        <div class="pm-prof-list">${profilesHtml}</div>
      </div>
      <div id="pm-indep-config-fields" class="pm-independent-api-fields pm-settings-section" ${useIndependent ? '' : 'hidden'}>
        <label class="pm-settings-field"><span class="pm-cfg-label">API 地址</span><input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.xxx.com 或 .../v1" value="${cfg.apiUrl}"></label>
        <label class="pm-settings-field"><span class="pm-cfg-label">API Key</span><input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." value="${cfg.apiKey}" maxlength="999"></label>
        <div class="pm-settings-field"><span class="pm-cfg-label">模型名称</span><div class="pm-model-row"><input id="pm-cfg-model" class="pm-cfg-input" placeholder="独立 API 必填：手动输入或选择" value="${cfg.model}"><button id="pm-model-arrow" type="button" aria-label="选择模型" onclick="window.__pmShowModelPicker()">▼</button></div></div>
        <label class="pm-settings-field" for="pm-cfg-temperature"><span class="pm-cfg-label">温度</span><input id="pm-cfg-temperature" class="pm-cfg-input" type="number" min="0" max="2" step="0.1" inputmode="decimal" value="${cfg.temperature}"><span class="pm-cfg-help">范围 0–2；数值越高，回复越随机。默认 1.2。</span></label>
        <div id="pm-api-status" class="pm-cfg-tip">测试连接不会覆盖当前配置，点击保存后生效</div>
        <div class="pm-action-row">
          <button id="pm-api-fetch-models" type="button" class="pm-action-button is-model-fetch" onclick="window.__pmTestApi(this)">拉取模型</button>
          <button id="pm-api-test-model" type="button" class="pm-action-button is-api-test" onclick="window.__pmTestModel(this)">测试 API</button>
        </div>
      </div>
      <div class="pm-settings-tail"></div>
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
    const preset = THEME_PRESETS[theme.preset] || THEME_PRESETS.default;
    const customAccent = theme.preset === 'custom' ? theme.customAccent || '' : '';
    const interfaceMode = theme.preset === 'apple' ? 'light' : theme.darkMode || 'light';
    const rightColor = theme.customRight || customAccent || (interfaceMode === 'dark' ? preset.rightDark || preset.right : preset.right);
    const leftColor = theme.customLeft || (interfaceMode === 'dark' ? preset.leftDark || preset.left : preset.left);
    const appleActive = theme.preset === 'apple';
    return `
    <div class="pm-settings-page">
      <div class="pm-settings-section">
        <label class="pm-cfg-label pm-ambient-setting">
          <span><b>显示本地状态栏</b><small>仅显示设备本地时间。</small></span>
          <div id="pm-ambient-status-enabled" class="pm-custom-check ${theme.ambientStatusEnabled === true ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${theme.ambientStatusEnabled === true}" onclick="const enabled=!this.classList.contains('is-checked');this.classList.toggle('is-checked',enabled);this.setAttribute('aria-checked',String(enabled));window.__pmSetAmbientStatus(enabled)" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>
      </div>
      <div class="pm-settings-section">
        <label class="pm-settings-field" for="pm-custom-title"><span class="pm-cfg-label">桌面标题</span><input id="pm-custom-title" class="pm-cfg-input" maxlength="20" value="${String(theme.customTitle || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}" placeholder="天音小笺" oninput="window.__pmSetCustomTitle()"><span class="pm-cfg-help">留空时显示“天音小笺”。</span></label>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">日夜模式</div>
        <div class="pm-theme-row">
          <button type="button" class="pm-layout-chip ${appleActive || theme.darkMode === 'light' ? 'pm-layout-active' : ''}" data-theme-mode="light" aria-pressed="${appleActive || theme.darkMode === 'light'}" onclick="window.__pmSetDarkMode('light')" ${appleActive ? 'disabled' : ''}>日间</button>
          <button type="button" class="pm-layout-chip ${!appleActive && theme.darkMode === 'dark' ? 'pm-layout-active' : ''}" data-theme-mode="dark" aria-pressed="${!appleActive && theme.darkMode === 'dark'}" onclick="window.__pmSetDarkMode('dark')" ${appleActive ? 'disabled' : ''}>夜间</button>
        </div>
        ${appleActive ? '<small class="pm-cfg-help">苹果皮肤固定为浅色。</small>' : ''}
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">主题颜色</div>
        <div class="pm-settings-inline-row pm-theme-row">${presetButtons}<input id="pm-custom-accent" type="color" value="${customAccent || preset.accent || preset.right}" onchange="window.__pmSetCustomAccent()" class="pm-color-pick" title="自定义主题色" aria-label="自定义主题色"></div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">气泡颜色</div>
        <div class="pm-settings-inline-row">
          <label class="pm-cfg-label pm-inline-label">自定义右</label>
          <input id="pm-custom-right" type="color" value="${rightColor}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <label class="pm-cfg-label pm-inline-label">自定义左</label>
          <input id="pm-custom-left" type="color" value="${leftColor}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <button type="button" onclick="window.__pmClearCustomColor()" class="pm-color-clear">重置</button>
        </div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">手机外框颜色</div>
        <div class="pm-settings-inline-row">
          <input id="pm-border-color" type="color" value="${theme.borderColor || '#1a1a1a'}" onchange="window.__pmSetBorderColor()" class="pm-color-pick" aria-label="手机外框颜色">
          <button type="button" onclick="document.getElementById('pm-border-color').value='#1a1a1a';window.__pmSetBorderColor()" class="pm-color-clear">重置</button>
        </div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">背景图</div>
        <div class="pm-settings-stack">
          <div class="pm-bg-row"><span class="pm-bg-label">桌面背景</span>${desktopBackgroundButtons}</div>
          <div class="pm-bg-row"><span class="pm-bg-label">全局背景</span>${globalBackgroundButtons}</div>
          <div class="pm-bg-row"><span class="pm-bg-label">本联系人</span>${localBackgroundButtons}</div>
        </div>
      </div>
      <div class="pm-settings-tail"></div>
    </div>`;
}

export function getBudgetPercentageView(sourceWeights) {
    const weights = {
        phone: Number(sourceWeights?.phone) || 0,
        community: Number(sourceWeights?.community) || 0,
        calendar: Number(sourceWeights?.calendar) || 0,
        todayTrend: Number(sourceWeights?.todayTrend) || 0,
    };
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (total <= 0) return { phone: 25, community: 25, calendar: 25, todayTrend: 25 };
    const phone = Number((weights.phone * 100 / total).toFixed(4));
    const community = Number((weights.community * 100 / total).toFixed(4));
    const calendar = Number((weights.calendar * 100 / total).toFixed(4));
    return { phone, community, calendar, todayTrend: Number((100 - phone - community - calendar).toFixed(4)) };
}

export function resolveBudgetPercentageInput({
    sourceWeights, phone, community, calendar, todayTrend,
    initialPhone, initialCommunity, initialCalendar, initialTodayTrend,
}) {
    const next = { phone: Number(phone), community: Number(community), calendar: Number(calendar), todayTrend: Number(todayTrend) };
    const initial = { phone: Number(initialPhone), community: Number(initialCommunity), calendar: Number(initialCalendar), todayTrend: Number(initialTodayTrend) };
    if (Object.keys(next).every(source => next[source] === initial[source])) {
        return { phone: sourceWeights.phone, community: sourceWeights.community, calendar: sourceWeights.calendar, todayTrend: sourceWeights.todayTrend };
    }
    if (!Object.values(next).every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
        throw new Error('各正文注入来源占比必须是 0 到 100 之间的数字');
    }
    if (Math.abs(Object.values(next).reduce((sum, value) => sum + value, 0) - 100) > 0.0001) {
        throw new Error('所有正文注入来源占比合计必须为 100%');
    }
    return next;
}

export function renderBudgetSettings({ config }) {
    const priority = config.sourcePriority[0];
    const percentages = getBudgetPercentageView(config.sourceWeights);
    return `
    <div class="pm-settings-page">
      <div class="pm-settings-section">
        <div class="pm-cfg-label">上下文预算</div>
        <div class="pm-cfg-tip">控制本插件写入主提示词的内容量，不限制模型输出。</div>
        <label class="pm-settings-field" for="pm-budget-target"><span class="pm-cfg-label">总目标（估算 token）</span><input id="pm-budget-target" class="pm-cfg-input" type="number" min="1" max="12000" step="1" value="${config.targetTokens}"><span class="pm-cfg-tip">数值越大，AI 能看到的手机和社区历史越多，也会占用更多上下文。</span></label>
        <div class="pm-budget-weight-list">
          <label class="pm-cfg-label">手机会话占比 (%)<input id="pm-budget-phone-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.phone}" data-initial-value="${percentages.phone}"></label>
          <label class="pm-cfg-label">互动社区占比 (%)<input id="pm-budget-community-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.community}" data-initial-value="${percentages.community}"></label>
          <label class="pm-cfg-label">日历模块占比 (%)<input id="pm-budget-calendar-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.calendar}" data-initial-value="${percentages.calendar}"></label>
          <label class="pm-cfg-label">今日风向占比 (%)<input id="pm-budget-today-trend-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.todayTrend}" data-initial-value="${percentages.todayTrend}"></label>
        </div>
        <div class="pm-cfg-tip">四类内容占比合计必须为 100%。日历模块包含生活日历、菜谱和穿搭。</div>
        <label class="pm-settings-field" for="pm-budget-priority"><span class="pm-cfg-label">剩余额度优先补给</span><select id="pm-budget-priority" class="pm-cfg-input">
          <option value="phone" ${priority === 'phone' ? 'selected' : ''}>手机会话优先</option>
          <option value="community" ${priority === 'community' ? 'selected' : ''}>互动社区优先</option>
          <option value="calendar" ${priority === 'calendar' ? 'selected' : ''}>日历模块优先</option>
          <option value="todayTrend" ${priority === 'todayTrend' ? 'selected' : ''}>今日风向优先</option>
        </select></label>
        <label class="pm-cfg-label pm-check-setting">
          <span>自动将未使用的额度补给仍有内容的模块</span>
          <div id="pm-budget-redistribute" class="pm-custom-check ${config.redistributeUnused ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${config.redistributeUnused}" onclick="this.classList.toggle('is-checked');this.setAttribute('aria-checked',String(this.classList.contains('is-checked')))" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>
      </div>
      <div class="pm-settings-tail"></div>
    </div>`;
}



export function renderBackupSettings() {
    return `
    <div class="pm-settings-page">
      <div class="pm-settings-section">
        <div class="pm-cfg-label">数据备份</div>
        <div class="pm-action-row">
          <button class="pm-action-button is-success" onclick="window.__pmExportData()">导出备份</button>
          <button class="pm-action-button is-accent" onclick="document.getElementById('pm-import-file').click()">导入备份</button>
          <input id="pm-import-file" type="file" accept=".json" onchange="window.__pmImportData(this)" hidden>
        </div>
        <div class="pm-cfg-tip is-warning">注意：导入会覆盖当前所有联系人、记录、社区与页面恢复状态</div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label is-danger">应用内安全清理</div>
        <div class="pm-cfg-tip">仅删除天音小笺拥有的数据，不触碰宿主或其他扩展。建议先导出备份。</div>
        <button type="button" class="pm-action-button is-danger is-full" onclick="window.__pmClearAllData()">清理全部天音小笺数据</button>
      </div>
      <div class="pm-settings-tail"></div>
    </div>`;
}

export function renderSettingsModal({ title, content, footer = '', showBack = true, backAction = "window.__pmShowConfig('home')", backLabel = '返回设置' }) {
    return `
<div class="pm-modal pm-modal-wide pm-settings-modal">
  <div class="pm-modal-header"><span>${showBack ? `<button type="button" onclick="${escapeAttr(backAction)}" class="pm-modal-close" title="${escapeAttr(backLabel)}" aria-label="${escapeAttr(backLabel)}">${BACK_ICON_SVG}</button>` : ''}</span><b>${title}</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll">${content}</div>
  ${footer}
</div>`;
}
