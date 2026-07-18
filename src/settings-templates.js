import { CLOSE_ICON_SVG } from './icons.js';

export function renderSettingsHome() {
    return `
    <div class="pm-settings-home" role="list">
      <button type="button" role="listitem" onclick="window.__pmShowConfig('api')"><b>API</b><span>选择主 API 或配置独立接口、密钥与模型</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('look')"><b>主题</b><span>日夜模式、气泡颜色与背景图</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('backup')"><b>备份</b><span>导出、导入或安全清理插件数据</span></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('budget')"><b>上下文预算</b><span>控制手机会话与社区写入主提示词的额度</span></button>
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
        <div id="pm-mode-tip" class="pm-cfg-tip" style="text-align:left;padding:6px 2px 0;">${useIndependent ? '独立 API 必须填写地址、密钥和模型' : '主 API 使用宿主当前选择的预设与接口'}</div>
      </div>
      <div style="padding:6px 14px 4px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin:8px 0 6px;">已保存档案</div>
        <div class="pm-prof-list">${profilesHtml}</div>
      </div>
      <div style="padding:10px 16px;display:flex;flex-direction:column;gap:10px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label">API 地址</div>
        <input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.xxx.com 或 .../v1" value="${cfg.apiUrl}">
        <div class="pm-cfg-label">API Key</div>
        <input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." value="${cfg.apiKey}" maxlength="999">
        <div class="pm-cfg-label">模型名称</div>
        <div class="pm-model-row">
          <input id="pm-cfg-model" class="pm-cfg-input" placeholder="独立 API 必填：手动输入或选择" value="${cfg.model}">
          <button id="pm-model-arrow" type="button" onclick="window.__pmShowModelPicker()">▼</button>
        </div>
        <div id="pm-api-status" class="pm-cfg-tip" style="font-weight:bold;">测试连接不会覆盖当前配置，点击保存后生效</div>
        <div style="display:flex;gap:6px;margin-top:4px;">
          <button onclick="window.__pmTestApi()" style="flex:1;background:#ff9500;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">拉取模型</button>
          <button onclick="window.__pmTestModel()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">测试 API</button>
        </div>
      </div>
      <div style="height:12px;"></div>
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
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;">
        <label class="pm-cfg-label pm-ambient-setting">
          <span><b>显示本地状态栏</b><small>仅显示设备本地时间，不联网、不定位，也不会写入提示词。</small></span>
          <div id="pm-ambient-status-enabled" class="pm-custom-check ${theme.ambientStatusEnabled === true ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${theme.ambientStatusEnabled === true}" onclick="const enabled=!this.classList.contains('is-checked');this.classList.toggle('is-checked',enabled);this.setAttribute('aria-checked',String(enabled));window.__pmSetAmbientStatus(enabled)" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>
      </div>
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;">
        <label class="pm-cfg-label" for="pm-custom-title">桌面标题</label>
        <input id="pm-custom-title" class="pm-cfg-input" maxlength="20" value="${String(theme.customTitle || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}" placeholder="天音小笺" oninput="window.__pmSetCustomTitle()">
        <small class="pm-cfg-help">留空时显示“天音小笺”。</small>
      </div>
      <div style="padding:14px 16px 12px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">气泡主题</div>
        <div class="pm-theme-row">${presetButtons}</div>
        <div style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap;">
          <label class="pm-cfg-label" style="margin:0;">自定义右</label>
          <input id="pm-custom-right" type="color" value="${theme.customRight || '#007aff'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <label class="pm-cfg-label" style="margin:0;">自定义左</label>
          <input id="pm-custom-left" type="color" value="${theme.customLeft || '#e9e9eb'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <button onclick="window.__pmClearCustomColor()" class="pm-color-clear">重置</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center;">
          <label class="pm-cfg-label" style="margin:0;">边框颜色</label>
          <input id="pm-border-color" type="color" value="${theme.borderColor || '#1a1a1a'}" onchange="window.__pmSetBorderColor()" class="pm-color-pick">
          <button onclick="document.getElementById('pm-border-color').value='#1a1a1a';window.__pmSetBorderColor()" class="pm-color-clear">重置</button>
        </div>
      </div>
      <div style="padding:12px 16px 12px;border-top:1px solid #f0f0f0;">
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

export function renderBudgetSettings({ config, sceneOptions }) {
    const priority = config.sourcePriority[0];
    const percentages = getBudgetPercentageView(config.sourceWeights);
    return `
    <div class="pm-settings-page">
      <div style="padding:12px 16px;display:flex;flex-direction:column;gap:10px;">
        <div class="pm-cfg-label">插件上下文预算（估算 token）</div>
        <div class="pm-cfg-tip" style="text-align:left;">限制本插件把多少手机会话和社区内容写进主提示词。它不会改变 AI 单次最多输出多少字。</div>
        <label class="pm-cfg-label" for="pm-budget-target">总目标（估算 token）</label>
        <input id="pm-budget-target" class="pm-cfg-input" type="number" min="1" max="12000" step="1" value="${config.targetTokens}">
        <div class="pm-cfg-tip" style="text-align:left;">数值越大，AI 能看到的手机和社区历史越多，也会占用更多上下文。</div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
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
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;display:flex;flex-direction:column;gap:10px;">
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
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;display:flex;flex-direction:column;gap:10px;">
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
      <div style="padding:12px 16px 12px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">数据备份</div>
        <div style="display:flex;gap:6px;">
          <button onclick="window.__pmExportData()" style="flex:1;background:#34c759;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">导出备份</button>
          <button onclick="document.getElementById('pm-import-file').click()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">导入备份</button>
          <input id="pm-import-file" type="file" accept=".json" onchange="window.__pmImportData(this)" hidden>
        </div>
        <div class="pm-cfg-tip" style="text-align:left;margin-top:6px;color:#ff9500;">注意：导入会覆盖当前所有联系人、记录、社区与页面恢复状态</div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:6px;color:#ff3b30;">应用内安全清理</div>
        <div class="pm-cfg-tip" style="text-align:left;margin-bottom:8px;">仅删除天音小笺拥有的数据，不触碰宿主或其他扩展。建议先导出备份。</div>
        <button type="button" onclick="window.__pmClearAllData()" style="width:100%;background:#ff3b30;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">清理全部天音小笺数据</button>
      </div>
      <div style="height:12px;"></div>
    </div>`;
}

export function renderSettingsModal({ title, content, footer = '', showBack = true }) {
    return `
<div class="pm-modal pm-modal-wide" style="height: 560px;">
  <div class="pm-modal-header"><span>${showBack ? '<button type="button" onclick="window.__pmShowConfig(\'home\')" class="pm-modal-close">设置</button>' : ''}</span><b>${title}</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll">${content}</div>
  ${footer}
</div>`;
}
