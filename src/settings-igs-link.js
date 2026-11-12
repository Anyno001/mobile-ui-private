// 设置 › 与gal前端联动。总开关关着时只显示开关本身，不探测 IGS；打开后显示两个子开关和接口状态。
import { escapeHtml } from './ui.js';
import { renderSettingsModal } from './settings-templates.js';
import { MAX_CHAT_FLOORS, normalizeChatFloors } from './igs-feed-core.js';

const API_STATUS_TEXT = Object.freeze({ ready: '已连接IGS', missing: '未检测到IGS', outdated: 'IGS版本过旧' });

const check = (id, label, hint, checked) => `<label class="pm-cfg-label pm-ambient-setting">
          <span>${escapeHtml(label)}<small>${escapeHtml(hint)}</small></span>
          <div id="${id}" class="pm-custom-check ${checked ? 'is-checked' : ''}" role="checkbox" tabindex="0" aria-checked="${checked}" onclick="window.__pmToggleIgsLink('${id}')" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
        </label>`;

export function renderIgsLinkSettings(status) {
    const { config } = status;
    const master = `<div class="pm-settings-section">
        ${check('pm-igs-link-enabled', '与gal前端联动', '读取正文中的社区帖子与聊天，只读不写', config.enabled)}
      </div>`;
    if (!config.enabled) return `<div class="pm-settings-page">${master}<div class="pm-settings-tail"></div></div>`;
    const lines = [API_STATUS_TEXT[status.api] || API_STATUS_TEXT.missing];
    if (config.syncChats && status.chatApi === 'outdated') lines.push('IGS版本过旧，聊天暂不能同步');
    if (status.lastError) lines.push(status.lastError);
    else if (status.lastSyncAt) lines.push(`上次同步：${status.lastResult}`);
    return `<div class="pm-settings-page">${master}
      <div class="pm-settings-section">
        ${check('pm-igs-link-auto-sync', '自动同步社区帖子', '正文有新楼层时导入', config.autoSync)}
        ${check('pm-igs-link-sync-live', '同步直播间', '正文里的直播与弹幕放进噼哩噼哩', config.syncLive)}
        ${check('pm-igs-link-auto-continue', '同步后自动续写一批', '每楼导入后生成一批新帖，消耗额外token', config.autoContinue)}
      </div>
      <div class="pm-settings-section">
        ${check('pm-igs-link-sync-chats', '同步聊天', '正文里的线上聊天放进私聊与群聊', config.syncChats)}
        ${config.syncChats ? `${check('pm-igs-link-auto-contacts', '自动新建联系人', '聊天对象不在通讯录时新建', config.autoCreateContacts)}
        <label class="pm-cfg-label pm-ambient-setting">
          <span>自动同步层数<small>更早的楼层用下方按钮导入</small></span>
          <input id="pm-igs-link-chat-floors" class="pm-cfg-input" type="number" min="0" max="${MAX_CHAT_FLOORS}" step="1" inputmode="numeric" value="${config.chatFloors}" onchange="window.__pmSaveIgsChatFloors(this)">
        </label>` : ''}
      </div>
      <div class="pm-settings-section">
        ${check('pm-igs-link-read-dna', '生图读取角色形象与衣装', '出图时优先使用gal前端的角色形象与衣装，只读不写', config.readDna)}
      </div>
      <div class="pm-settings-section">
        ${check('pm-igs-link-notify', '新消息时播放提醒演出', '手机后台自动产生新消息或新帖时，由gal前端播放提醒，不写入正文', config.notifyOnNew)}
      </div>
      <div class="pm-settings-section">
        <div class="pm-cfg-label">状态</div>
        ${lines.map((line, index) => `<div class="pm-cfg-tip${index === 1 && status.lastError ? ' is-warning' : ''}" aria-live="polite">${escapeHtml(line)}</div>`).join('')}
        <button type="button" class="pm-action-button is-full" onclick="window.__pmImportIgsFeeds(this)">从正文导入全部楼层</button>
      </div>
      <div class="pm-settings-tail"></div>
    </div>`;
}

const FIELD_BY_ID = Object.freeze({
    'pm-igs-link-enabled': 'enabled', 'pm-igs-link-auto-sync': 'autoSync', 'pm-igs-link-auto-continue': 'autoContinue', 'pm-igs-link-sync-live': 'syncLive',
    'pm-igs-link-sync-chats': 'syncChats', 'pm-igs-link-auto-contacts': 'autoCreateContacts', 'pm-igs-link-read-dna': 'readDna', 'pm-igs-link-notify': 'notifyOnNew',
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
    window.__pmSaveIgsChatFloors = input => {
        const link = getIgsLink();
        if (!link) return false;
        const value = normalizeChatFloors(input?.value);
        if (input) input.value = String(value);
        if (!link.setConfig({ chatFloors: value })) {
            alert('联动设置保存失败：浏览器存储不可用。');
            return false;
        }
        return true;
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
