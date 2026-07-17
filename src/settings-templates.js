export function renderApiSettings({ cfg, useIndependent, profilesHtml }) {
    return `
    <div class="pm-settings-page">
      <div style="padding:12px 14px 6px;">
        <div class="pm-cfg-label" style="margin-bottom:6px;">API 模式</div>
        <div class="pm-mode-switch">
          <div id="pm-mode-main" class="pm-mode-opt ${!useIndependent ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(false)">主 API</div>
          <div id="pm-mode-indep" class="pm-mode-opt ${useIndependent ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(true)">独立 API</div>
        </div>
        <div id="pm-mode-tip" class="pm-cfg-tip" style="text-align:left;padding:6px 2px 0;">${useIndependent ? '独立 API' : '主 API'}</div>
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
          <input id="pm-cfg-model" class="pm-cfg-input" placeholder="手动输入或 ▼" value="${cfg.model}">
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


export function renderLookSettings({ theme, presetButtons, globalBackgroundButtons, localBackgroundButtons }) {
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
          <input id="pm-ambient-status-enabled" type="checkbox" ${theme.ambientStatusEnabled === true ? 'checked' : ''} onchange="window.__pmSetAmbientStatus(this.checked)">
          <span><b>显示本地状态栏</b><small>仅显示设备本地时间，不联网、不定位，也不会写入提示词。</small></span>
        </label>
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
          <div class="pm-bg-row"><span class="pm-bg-label">全局背景</span>${globalBackgroundButtons}</div>
          <div class="pm-bg-row"><span class="pm-bg-label">本联系人</span>${localBackgroundButtons}</div>
        </div>
      </div>
      <div style="height:12px;"></div>
    </div>`;
}

export function renderBudgetSettings({ config, sceneOptions }) {
    const priorityCommunity = config.sourcePriority[0] === 'community';
    return `
    <div class="pm-settings-page">
      <div style="padding:12px 16px;display:flex;flex-direction:column;gap:10px;">
        <div class="pm-cfg-label">插件上下文预算（估算 token）</div>
        <div class="pm-cfg-tip" style="text-align:left;">只约束本插件写入的手机会话与互动社区 extension prompt，不修改 AI 输出 max_tokens。</div>
        <label class="pm-cfg-label" for="pm-budget-target">总目标（估算 token）</label>
        <input id="pm-budget-target" class="pm-cfg-input" type="number" min="1" max="12000" step="1" value="${config.targetTokens}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label class="pm-cfg-label">手机会话权重<input id="pm-budget-phone-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.1" value="${config.sourceWeights.phone}"></label>
          <label class="pm-cfg-label">互动社区权重<input id="pm-budget-community-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.1" value="${config.sourceWeights.community}"></label>
        </div>
        <label class="pm-cfg-label" for="pm-budget-priority">未用额度优先回流</label>
        <select id="pm-budget-priority" class="pm-cfg-input">
          <option value="phone" ${priorityCommunity ? '' : 'selected'}>手机会话优先</option>
          <option value="community" ${priorityCommunity ? 'selected' : ''}>互动社区优先</option>
        </select>
        <label class="pm-cfg-label"><input id="pm-budget-redistribute" type="checkbox" ${config.redistributeUnused ? 'checked' : ''}> 允许未用额度按上述优先级回流</label>
      </div>
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;display:flex;flex-direction:column;gap:10px;">
        <label class="pm-cfg-label"><input id="pm-budget-community-enabled" type="checkbox" ${config.communityEnabled ? 'checked' : ''}> 启用互动社区注入（默认关闭）</label>
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

export function renderSettingsModal({ title, content, footer = '' }) {
    return `
<div class="pm-modal pm-modal-wide" style="height: 560px;">
  <div class="pm-modal-header"><b>${title}</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close">关闭</button></div>
  <div class="pm-modal-scroll">${content}</div>
  ${footer}
</div>`;
}
