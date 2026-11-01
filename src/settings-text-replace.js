// 设置 › 文字替换：规则列表，每条含查找、替换为与启用开关。
import { escapeAttr } from './ui.js';
import { renderSettingsModal } from './settings-templates.js';
import { MAX_TEXT_REPLACE_RULES, loadTextReplaceRules, saveTextReplaceRules } from './text-replace.js';

export function renderTextReplaceSettings(rules) {
    const rows = rules.map((rule, index) => `<div class="pm-settings-section pm-text-replace-row">
        <input class="pm-cfg-input" type="text" value="${escapeAttr(rule.find)}" placeholder="查找，如 张三 或 /张(三|四)/g" aria-label="查找" onchange="window.__pmSetTextReplace(${index},'find',this.value)">
        <input class="pm-cfg-input" type="text" value="${escapeAttr(rule.replace)}" placeholder="替换为" aria-label="替换为" onchange="window.__pmSetTextReplace(${index},'replace',this.value)">
        <div class="pm-text-replace-actions">
          <div class="pm-custom-check ${rule.enabled ? 'is-checked' : ''}" role="switch" tabindex="0" aria-checked="${rule.enabled}" aria-label="启用" onclick="window.__pmSetTextReplace(${index},'enabled',${!rule.enabled})" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}"></div>
          <button type="button" class="pm-action-button is-danger" onclick="window.__pmDeleteTextReplace(${index})">删除</button>
        </div>
      </div>`).join('');
    return `<div class="pm-settings-page">
      <div class="pm-settings-section"><div class="pm-cfg-tip">AI生成的文字在保存前按顺序替换，已保存的内容不受影响。查找可写普通文本，或写成 /正则/标志。</div></div>
      ${rows}
      <div class="pm-settings-tail"></div>
    </div>`;
}

export function installTextReplaceSettings({ makeOverlay }) {
    let rules = [];
    const showPage = () => {
        rules = loadTextReplaceRules().map(rule => ({ ...rule }));
        makeOverlay(renderSettingsModal({
            title: '文字替换', content: renderTextReplaceSettings(rules),
            footer: '<div class="pm-modal-add"><button type="button" class="pm-action-button is-accent is-full" onclick="window.__pmAddTextReplace()">添加规则</button></div>',
        }));
    };
    const persist = next => {
        if (!saveTextReplaceRules(next)) { alert('文字替换保存失败：浏览器存储不可用。'); return false; }
        rules = next;
        return true;
    };
    window.__pmAddTextReplace = () => {
        if (rules.length >= MAX_TEXT_REPLACE_RULES) { alert(`最多添加${MAX_TEXT_REPLACE_RULES}条规则。`); return false; }
        if (persist([...rules, { find: '', replace: '', enabled: true }])) showPage();
        return true;
    };
    window.__pmDeleteTextReplace = index => {
        if (persist(rules.filter((rule, i) => i !== index))) showPage();
    };
    window.__pmSetTextReplace = (index, field, value) => {
        if (!rules[index] || !['find', 'replace', 'enabled'].includes(field)) return false;
        const next = rules.map((rule, i) => i === index ? { ...rule, [field]: value } : rule);
        if (!persist(next)) return false;
        if (field === 'enabled') showPage();
        return true;
    };
    return { showPage };
}
