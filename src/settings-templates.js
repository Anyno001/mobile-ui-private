import { BACK_ICON_SVG, CLOSE_ICON_SVG } from './icons.js';
import { FONT_CHOICES, normalizeFontChoice, normalizeWallpaper, THEME_PRESETS } from './config.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { loadImageSettings } from './phone-image-settings.js';
import { DEFAULT_ROLLBACK_FLOORS, MAX_ROLLBACK_FLOORS } from './phone-floor-rollback.js';

export function renderSettingsHome() {
    return `
    <div class="pm-settings-home" role="list">
      <button type="button" role="listitem" onclick="window.__pmShowConfig('api')"><b>API</b></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('quick-reply')"><b>手机开关</b></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('look')"><b>主题</b></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('backup')"><b>备份</b></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('worldbook')"><b>世界书读取</b></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('budget')"><b>上下文预算</b></button>
      <button type="button" role="listitem" onclick="window.__pmShowConversationInjection()"><b>正文注入</b></button>
      <button type="button" role="listitem" onclick="window.__pmShowConfig('igs-link')"><b>与gal前端联动</b></button>
      <div class="pm-global-setting" role="group" aria-labelledby="pm-wordy-label">
        <span><b id="pm-wordy-label">全局短消息限制</b><span class="pm-settings-home-hint">除话痨人设外，每条消息不超过 35 字</span></span>
        <div id="pm-wordy-check" onclick="window.__pmToggleWordyLimit()"
          class="pm-custom-check ${window.__pmWordyLimit === true ? 'is-checked' : ''}" role="checkbox" tabindex="0"
          aria-checked="${window.__pmWordyLimit === true}"
          onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
      </div>
      <div class="pm-settings-home-group" role="group" aria-label="生图">
      <div class="pm-global-setting" role="group" aria-labelledby="pm-image-gen-label">
        <span><b id="pm-image-gen-label">启用生图</b><span class="pm-settings-home-hint">关闭后隐藏所有生图按钮与相册，图片只显示文字描述</span></span>
        <div id="pm-image-gen-check" onclick="window.__pmToggleImageGen()"
          class="pm-custom-check ${loadImageSettings().enabled ? 'is-checked' : ''}" role="checkbox" tabindex="0"
          aria-checked="${loadImageSettings().enabled}"
          onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
      </div>
      <button type="button" class="pm-settings-home-link" onclick="window.__pmOpenImageSettings()"><span><b>出图来源与生图方案</b><span class="pm-settings-home-hint">数据库生图插件或内置 NAI、CORS 代理、画师串</span></span><span aria-hidden="true">›</span></button>
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

export function renderApiSettings({ cfg, useIndependent, profilesHtml, routesHtml = '' }) {
    return `
    <div class="pm-settings-page">
      <div class="pm-settings-section">
        <div class="pm-cfg-label">API模式</div>
        <div class="pm-mode-switch">
          <div id="pm-mode-main" class="pm-mode-opt ${!useIndependent ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(false)">主API</div>
          <div id="pm-mode-indep" class="pm-mode-opt ${useIndependent ? 'pm-mode-active' : ''}" onclick="window.__pmSetMode(true)">独立API</div>
        </div>
        <div id="pm-mode-tip" class="pm-cfg-tip">${useIndependent ? '独立 API 必须填写地址、密钥和模型' : '默认使用酒馆API预设'}</div>
      </div>
      <div id="pm-indep-profile-fields" class="pm-independent-api-fields pm-settings-section" ${useIndependent ? '' : 'hidden'}>
        <div class="pm-api-profile-head"><span class="pm-cfg-label">API预设</span><button type="button" class="pm-action-button is-secondary pm-api-profile-new" onclick="window.__pmNewProfile()">新建预设</button></div>
        <div class="pm-prof-list">${profilesHtml}</div>
      </div>
      <div id="pm-indep-config-fields" class="pm-independent-api-fields pm-settings-section" ${useIndependent ? '' : 'hidden'}>
        <label class="pm-settings-field"><span class="pm-cfg-label">预设名称</span><input id="pm-cfg-name" class="pm-cfg-input" placeholder="留空则用模型名" maxlength="24" value="${cfg.name}"></label>
        <label class="pm-settings-field"><span class="pm-cfg-label">API地址</span><input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.xxx.com 或 .../v1" value="${cfg.apiUrl}"></label>
        <label class="pm-settings-field"><span class="pm-cfg-label">API Key</span><input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." value="${cfg.apiKey}" maxlength="999"></label>
        <div class="pm-settings-field"><span class="pm-cfg-label">模型名称</span><div class="pm-model-row"><input id="pm-cfg-model" class="pm-cfg-input" placeholder="手动输入或选择" value="${cfg.model}"><button id="pm-model-arrow" type="button" aria-label="选择模型" onclick="window.__pmShowModelPicker()">▼</button></div></div>
        <label class="pm-settings-field" for="pm-cfg-temperature"><span class="pm-cfg-label">温度</span><input id="pm-cfg-temperature" class="pm-cfg-input" type="number" min="0" max="2" step="0.1" inputmode="decimal" value="${cfg.temperature}"><span class="pm-cfg-help">范围 0–2；数值越高，回复越随机。默认 1.2。</span></label>
        <div id="pm-api-status" class="pm-cfg-tip">测试连接不会覆盖当前配置，点击保存后生效</div>
        <div class="pm-action-row">
          <button id="pm-api-fetch-models" type="button" class="pm-action-button is-model-fetch" onclick="window.__pmTestApi(this)">拉取模型</button>
          <button id="pm-api-test-model" type="button" class="pm-action-button is-api-test" onclick="window.__pmTestModel(this)">测试API</button>
        </div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">按模块分配</div>
        <div class="pm-cfg-help">各模块可单独指定预设，选择后即时生效；「跟随默认」使用上方保存的模式。</div>
        <div class="pm-api-route-list">${routesHtml}</div>
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
        unavailable: status.error || '当前版本不支持快捷回复。',
    };
    return `<div class="pm-settings-page pm-quick-reply-settings">
      <section>
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
    const interfaceMode = theme.darkMode || 'light';
    const rightColor = theme.customRight || customAccent || (interfaceMode === 'dark' ? preset.rightDark || preset.right : preset.right);
    const leftColor = theme.customLeft || (interfaceMode === 'dark' ? preset.leftDark || preset.left : preset.left);
    return `
    <div class="pm-settings-page">
      <div class="pm-settings-group"><div class="pm-settings-group-title">外观</div><div class="pm-settings-group-card">
      <div class="pm-settings-section">
        <div class="pm-cfg-label">日夜模式</div>
        <div class="pm-theme-row">
          <button type="button" class="pm-layout-chip ${theme.darkMode === 'light' ? 'pm-layout-active' : ''}" data-theme-mode="light" aria-pressed="${theme.darkMode === 'light'}" onclick="window.__pmSetDarkMode('light')">日间</button>
          <button type="button" class="pm-layout-chip ${theme.darkMode === 'dark' ? 'pm-layout-active' : ''}" data-theme-mode="dark" aria-pressed="${theme.darkMode === 'dark'}" onclick="window.__pmSetDarkMode('dark')">夜间</button>
        </div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">图标风格</div>
        <div class="pm-theme-row">
          <button type="button" class="pm-layout-chip ${theme.iconStyle !== 'cream' ? 'pm-layout-active' : ''}" data-icon-variant="glass" aria-pressed="${theme.iconStyle !== 'cream'}" onclick="window.__pmSetIconStyle('glass')">毛玻璃</button>
          <button type="button" class="pm-layout-chip ${theme.iconStyle === 'cream' ? 'pm-layout-active' : ''}" data-icon-variant="cream" aria-pressed="${theme.iconStyle === 'cream'}" onclick="window.__pmSetIconStyle('cream')">奶油渐层</button>
        </div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">字体</div>
        <div class="pm-theme-row">
          ${Object.entries(FONT_CHOICES).map(([key, choice]) => {
            const active = normalizeFontChoice(theme.fontFamily) === key;
            return `<button type="button" class="pm-layout-chip pm-font-chip ${active ? 'pm-layout-active' : ''}" data-font-choice="${key}" aria-pressed="${active}" onclick="window.__pmSetFontFamily('${key}')">${choice.label}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">背景</div>
        <div class="pm-theme-row">
          <button type="button" class="pm-layout-chip ${normalizeWallpaper(theme.wallpaper) === 'soft' ? 'pm-layout-active' : ''}" data-wallpaper-variant="soft" aria-pressed="${normalizeWallpaper(theme.wallpaper) === 'soft'}" onclick="window.__pmSetWallpaper('soft')">柔光</button>
          <button type="button" class="pm-layout-chip ${theme.wallpaper === 'bright' ? 'pm-layout-active' : ''}" data-wallpaper-variant="bright" aria-pressed="${theme.wallpaper === 'bright'}" onclick="window.__pmSetWallpaper('bright')">灿烂</button>
          <button type="button" class="pm-layout-chip ${theme.wallpaper === 'plain' ? 'pm-layout-active' : ''}" data-wallpaper-variant="plain" aria-pressed="${theme.wallpaper === 'plain'}" onclick="window.__pmSetWallpaper('plain')">纯白</button>
        </div>
      </div>
      <div class="pm-settings-section">
        <label class="pm-cfg-label pm-ambient-setting">
          <span><b>显示本地状态栏</b></span>
          <div id="pm-ambient-status-enabled" class="pm-custom-check ${theme.ambientStatusEnabled === true ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${theme.ambientStatusEnabled === true}" onclick="const enabled=!this.classList.contains('is-checked');this.classList.toggle('is-checked',enabled);this.setAttribute('aria-checked',String(enabled));window.__pmSetAmbientStatus(enabled)" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>
      </div>
      </div></div>
      <div class="pm-settings-group"><div class="pm-settings-group-title">颜色</div><div class="pm-settings-group-card">
      <div class="pm-settings-section">
        <div class="pm-cfg-label">主题颜色</div>
        <div class="pm-settings-inline-row pm-theme-row">${presetButtons}<input id="pm-custom-accent" type="color" value="${customAccent || preset.accent || preset.right}" onchange="window.__pmSetCustomAccent()" class="pm-color-pick" title="自定义主题色" aria-label="自定义主题色"></div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">气泡颜色</div>
        <div class="pm-settings-inline-row">
          <input id="pm-custom-left" type="color" value="${leftColor}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <label class="pm-cfg-label pm-inline-label">自定义左</label>
          <input id="pm-custom-right" type="color" value="${rightColor}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <label class="pm-cfg-label pm-inline-label">自定义右</label>
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
      </div></div>
      <div class="pm-settings-group"><div class="pm-settings-group-title">桌面</div><div class="pm-settings-group-card">
      <div class="pm-settings-section">
        <label class="pm-settings-field" for="pm-custom-title"><span class="pm-cfg-label">桌面标题</span><input id="pm-custom-title" class="pm-cfg-input" maxlength="20" value="${String(theme.customTitle || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}" placeholder="天音小笺" oninput="window.__pmSetCustomTitle()"></label>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">背景图</div>
        <div class="pm-settings-stack">
          <div class="pm-bg-row"><span class="pm-bg-label">桌面背景</span>${desktopBackgroundButtons}</div>
          <div class="pm-bg-row"><span class="pm-bg-label">全局背景</span>${globalBackgroundButtons}</div>
          <div class="pm-bg-row"><span class="pm-bg-label">本联系人</span>${localBackgroundButtons}</div>
        </div>
      </div>
      </div></div>
      <div class="pm-settings-section">
        <button type="button" class="pm-settings-subpage-button" onclick="window.__pmShowConfig('appearance-pack')"><span><b>一键美化</b></span><span aria-hidden="true">›</span></button>
        <button type="button" class="pm-settings-subpage-button" onclick="window.__pmShowConfig('desktop-icons')"><span><b>自定义图标</b></span><span aria-hidden="true">›</span></button>
      </div>
      <div class="pm-settings-tail"></div>
    </div>`;
}

export function renderAppearancePackSettings() {
    return `<div class="pm-settings-page pm-appearance-pack-settings">
      <div class="pm-settings-section">
        <div class="pm-cfg-tip">仅含主题外观、背景与桌面图标，不含聊天与API配置；远程图片链接不打包。</div>
        <label class="pm-settings-field" for="pm-appearance-name"><span class="pm-cfg-label">美化名称</span><input id="pm-appearance-name" class="pm-cfg-input" maxlength="60" placeholder="例如：薄荷日记"></label>
        <label class="pm-settings-field" for="pm-appearance-author"><span class="pm-cfg-label">作者</span><input id="pm-appearance-author" class="pm-cfg-input" maxlength="60" placeholder="可留空"></label>
        <label class="pm-settings-field" for="pm-appearance-description"><span class="pm-cfg-label">说明</span><textarea id="pm-appearance-description" class="pm-cfg-input" maxlength="500" rows="4" placeholder="可留空"></textarea></label>
      </div>
      <div class="pm-settings-section">
        <input id="pm-appearance-pack-file" type="file" accept="application/json,.json" onchange="window.__pmImportAppearancePack(this)" hidden>
        <button type="button" class="pm-action-button is-secondary is-full" onclick="document.getElementById('pm-appearance-pack-file').click()">选择美化包</button>
        <button type="button" class="pm-action-button is-accent is-full" onclick="window.__pmExportAppearancePack()">导出美化包</button>
      </div>
      <div class="pm-settings-tail"></div>
    </div>`;
}

export function renderAppearancePackPreview(preview) {
    const meta = preview?.meta || {};
    const backgrounds = preview?.backgrounds || {};
    const iconIds = Array.isArray(preview?.iconIds) ? preview.iconIds : [];
    const theme = preview?.theme || {};
    const backgroundItems = [
        ['桌面背景', !!backgrounds.desktop],
        ['全局背景', !!backgrounds.global],
        ['当前联系人背景', !!backgrounds.currentContact && preview.currentContactWillApply === true],
    ].map(([label, included]) => `<li><span>${label}</span><b>${included ? '将覆盖' : '不应用'}</b></li>`).join('');
    return `<div class="pm-settings-page pm-appearance-pack-preview">
      <div class="pm-settings-section">
        <div class="pm-cfg-label">${escapeHtml(meta.name || '未命名美化')}</div>
        <div class="pm-cfg-tip">作者：${escapeHtml(meta.author || '未填写')}<br>版本：${Number(preview?.schemaVersion) || 1}<br>大小：${Number(preview?.totalBytes) || 0} 字节</div>
        ${meta.description ? `<p>${escapeHtml(meta.description)}</p>` : ''}
      </div>
      <div class="pm-settings-section"><div class="pm-cfg-label">主题</div><div class="pm-cfg-tip">${escapeHtml(theme.darkMode === 'dark' ? '夜间' : '日间')} · ${escapeHtml(theme.preset || 'default')}</div></div>
      <div class="pm-settings-section"><div class="pm-cfg-label">背景</div><ul class="pm-appearance-preview-list">${backgroundItems}</ul></div>
      <div class="pm-settings-section"><div class="pm-cfg-label">桌面图标</div><div class="pm-cfg-tip">将覆盖 ${iconIds.length} 项：${escapeHtml(iconIds.join('、') || '无')}</div></div>
      <div class="pm-action-row">
        <button type="button" class="pm-action-button is-secondary" onclick="window.__pmCancelAppearanceImport()">取消</button>
        <button type="button" class="pm-action-button is-accent" onclick="window.__pmConfirmAppearanceImport()">确认导入</button>
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
        <label class="pm-settings-field" for="pm-budget-target"><span class="pm-cfg-label">总目标（估算 token）</span><input id="pm-budget-target" class="pm-cfg-input" type="number" min="1" max="12000" step="1" value="${config.targetTokens}"></label>
        <div class="pm-budget-weight-list">
          <label class="pm-cfg-label">手机会话占比 (%)<input id="pm-budget-phone-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.phone}" data-initial-value="${percentages.phone}"></label>
          <label class="pm-cfg-label">互动社区占比 (%)<input id="pm-budget-community-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.community}" data-initial-value="${percentages.community}"></label>
          <label class="pm-cfg-label">日历模块占比 (%)<input id="pm-budget-calendar-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.calendar}" data-initial-value="${percentages.calendar}"></label>
          <label class="pm-cfg-label">今日风向占比 (%)<input id="pm-budget-today-trend-weight" class="pm-cfg-input" type="number" min="0" max="100" step="0.0001" value="${percentages.todayTrend}" data-initial-value="${percentages.todayTrend}"></label>
        </div>
        <div class="pm-cfg-tip">四项合计 100%。</div>
        <label class="pm-settings-field" for="pm-budget-priority"><span class="pm-cfg-label">剩余额度优先补给</span><select id="pm-budget-priority" class="pm-cfg-input">
          <option value="phone" ${priority === 'phone' ? 'selected' : ''}>手机会话优先</option>
          <option value="community" ${priority === 'community' ? 'selected' : ''}>互动社区优先</option>
          <option value="calendar" ${priority === 'calendar' ? 'selected' : ''}>日历模块优先</option>
          <option value="todayTrend" ${priority === 'todayTrend' ? 'selected' : ''}>今日风向优先</option>
        </select></label>
        <label class="pm-cfg-label pm-check-setting">
          <span>未用完的额度补给其他模块</span>
          <div id="pm-budget-redistribute" class="pm-custom-check ${config.redistributeUnused ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${config.redistributeUnused}" onclick="this.classList.toggle('is-checked');this.setAttribute('aria-checked',String(this.classList.contains('is-checked')))" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>
      </div>
      <div class="pm-settings-tail"></div>
    </div>`;
}



export function renderBackupSettings({ rollbackFloors = DEFAULT_ROLLBACK_FLOORS } = {}) {
    return `
    <div class="pm-settings-page">
      <div class="pm-settings-section">
        <label class="pm-cfg-label" for="pm-rollback-floors">删楼回退保留层数</label>
        <input id="pm-rollback-floors" class="pm-cfg-input" type="number" min="0" max="${MAX_ROLLBACK_FLOORS}" step="1" inputmode="numeric" value="${rollbackFloors}" onchange="window.__pmSaveRollbackFloors(this)">
        <div class="pm-cfg-tip">主线删楼后，此后的手机消息随之撤回；保留层数内的编辑、删除与重新生成可还原，0为不保留。</div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">数据备份</div>
        <div class="pm-action-row">
          <button class="pm-action-button" onclick="window.__pmExportData()">导出备份</button>
          <button class="pm-action-button is-accent" onclick="document.getElementById('pm-import-file').click()">导入备份</button>
          <input id="pm-import-file" type="file" accept=".json" onchange="window.__pmImportData(this)" hidden>
        </div>
        <div class="pm-cfg-tip is-warning">导入会覆盖当前全部数据。</div>
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">清理数据</div>
        <div class="pm-cfg-tip">只清除本插件的数据，建议先导出备份。</div>
        <button type="button" class="pm-action-button is-danger-text is-full" onclick="window.__pmClearAllData()">清理全部天音小笺数据</button>
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
