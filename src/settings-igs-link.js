// 设置 › 与gal前端联动。总开关关着时只显示开关本身，不探测 IGS；打开后显示两个子开关和接口状态。
import { escapeHtml } from './ui.js';
import { renderSettingsModal } from './settings-templates.js';

const API_STATUS_TEXT = Object.freeze({ ready: '已连接IGS', missing: '未检测到IGS', outdated: 'IGS版本过旧' });

const check = (id, label, hint, checked) => `<label class="pm-cfg-label pm-ambient-setting">
          <span>${escapeHtml(label)}<small>${escapeHtml(hint)}</small></span>
          <div id="${id}" class="pm-custom-check ${checked ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${checked}" onclick="window.__pmToggleIgsLink('${id}')" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>`;

export function renderIgsLinkSettings(status) {
    const { config } = status;
    const master = `<div class="pm-settings-section">
        ${check('pm-igs-link-enabled', '与gal前端联动', '读取正文中的社区帖子，只读不写', config.enabled)}
      </div>`;
    if (!config.enabled) return `<div class="pm-settings-page">${master}<div class="pm-settings-tail"></div></div>`;
    const lines = [API_STATUS_TEXT[status.api] || API_STATUS_TEXT.missing];
    if (status.lastError) lines.push(status.lastError);
    else if (status.lastSyncAt) lines.push(`上次同步：${status.lastResult}`);
    return `<div class="pm-settings-page">${master}
      <div class="pm-settings-section">
        ${check('pm-igs-link-auto-sync', '自动同步社区帖子', '正文有新楼层时导入', config.autoSync)}
        ${check('pm-igs-link-sync-live', '同步直播间', '正文里的直播与弹幕放进噼哩噼哩', config.syncLive)}
        ${check('pm-igs-link-auto-continue', '同步后自动续写一批', '每楼导入后生成一批新帖，消耗额外token', config.autoContinue)}
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">状态</div>
        ${lines.map((line, index) => `<div class="pm-cfg-tip${index === 1 && status.lastError ? ' is-warning' : ''}" aria-live="polite">${escapeHtml(line)}</div>`).join('')}
        <button type="button" class="pm-action-button is-full" onclick="window.__pmImportIgsFeeds(this)">从正文导入社区帖子</button>
      </div>
      <div class="pm-settings-tail"></div>
    </div>`;
}

const FIELD_BY_ID = Object.freeze({
    'pm-igs-link-enabled': 'enabled', 'pm-igs-link-auto-sync': 'autoSync', 'pm-igs-link-auto-continue': 'autoContinue', 'pm-igs-link-sync-live': 'syncLive',
});

export function installIgsLinkSettings({ makeOverlay, getIgsLink }) {
    const showPage = () => {
        const link = getIgsLink();
        if (!link) return false;
        makeOverlay(renderSettingsModal({ title: '与gal前端联动', content: renderIgsLinkSettings(link.getStatus()) }));
        return true;
    };
    window.__pmToggleIgsLink = id => {
        const link = getIgsLink();
        const field = FIELD_BY_ID[id];
        if (!link || !field) return false;
        if (!link.setConfig({ [field]: !link.getConfig()[field] })) {
            alert('联动设置保存失败：浏览器存储不可用。');
            return false;
        }
        return showPage();
    };
    window.__pmImportIgsFeeds = async button => {
        const link = getIgsLink();
        if (!link) return false;
        if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
        try { await link.importNow(); } catch { /* 结果和错误都写在状态里，重绘后显示 */ }
        return showPage();
    };
    return { showPage };
}
