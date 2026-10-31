// 生图设置页与方案编辑窗。由相册 App 调用。
import { dbgenStatus } from './phone-image-dbgen.js';
import { NAI_OFFICIAL_MODELS, NAI_SAMPLERS, NAI_TRANSPORTS } from './phone-image-nai.js';
import {
    createPresetFrom, GLOBAL_PROFILE_ID, IMAGE_MODULES, IMAGE_PRESET_LIMIT, IMAGE_RATIO_LABELS, IMAGE_SOURCE_LABELS,
    loadImageSettings, normalizeImageProfile, saveImageSettings,
} from './phone-image-settings.js';
import { CLOSE_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const TRANSPORT_LABELS = Object.freeze({ auto: '自动', 'st-proxy': '酒馆代理', direct: '浏览器直连' });

const profileSummary = profile => [IMAGE_SOURCE_LABELS[profile.source], IMAGE_RATIO_LABELS[profile.ratio],
    profile.source === 'nai' ? profile.nai.model : profile.model || '插件默认模型'].join(' · ');

export function renderImageSettingsPage(header) {
    const settings = loadImageSettings();
    const status = dbgenStatus();
    const naiReady = !!settings.global.nai.apiKey;
    const sourceOk = settings.global.source === 'nai' ? naiReady : status.ok;
    const sourceStatus = settings.global.source === 'nai'
        ? (naiReady ? '当前使用内置 NAI' : '当前使用内置 NAI，尚未填写 Key')
        : (status.ok ? '当前使用数据库生图插件（已连接）' : status.error);
    const toggle = (key, title, hint) => `<button type="button" class="pm-gallery-toggle-row" role="switch" aria-checked="${settings[key]}" data-gallery-action="toggle" data-key="${key}"><span><b>${title}</b>${hint ? `<small>${hint}</small>` : ''}</span><i class="pm-control-toggle ${settings[key] ? 'is-checked' : ''}" aria-hidden="true"></i></button>`;
    const profiles = [settings.global, ...settings.presets];
    const moduleRows = Object.entries(IMAGE_MODULES).map(([key, label]) => {
        const options = profiles.map(profile => `<button type="button" role="radio" class="pm-gallery-tab" data-gallery-action="module-profile" data-module="${key}" data-profile="${escapeAttr(profile.id)}" aria-checked="${settings.modules[key] === profile.id}">${escapeHtml(profile.id === GLOBAL_PROFILE_ID ? '跟随全局' : profile.name)}</button>`).join('');
        return `<div class="pm-gallery-module-row"><b>${label}</b><div class="pm-gallery-tabs is-wrap" role="radiogroup" aria-label="${label}使用的方案">${options}</div></div>`;
    }).join('');
    const profileRows = profiles.map(profile => `<li class="pm-gallery-person"><div class="pm-gallery-person-text"><b>${escapeHtml(profile.id === GLOBAL_PROFILE_ID ? '全局方案' : profile.name)}</b><small>${escapeHtml(profileSummary(profile))}</small></div><button type="button" class="pm-gallery-chip" data-gallery-action="edit-profile" data-profile="${escapeAttr(profile.id)}">编辑</button></li>`).join('');
    return `<div class="pm-gallery-shell">
  ${header('生图设置', { back: 'grid' })}
  <div class="pm-gallery-scroll">
    <p class="pm-gallery-plugin ${sourceOk ? 'is-ok' : 'is-missing'}" role="status">${escapeHtml(sourceStatus)}</p>
    <section class="pm-gallery-section"><b class="pm-gallery-section-title">出图来源（全局方案）</b>
      <div class="pm-gallery-tabs" role="radiogroup" aria-label="全局出图来源">${Object.entries(IMAGE_SOURCE_LABELS).map(([key, label]) => `<button type="button" role="radio" class="pm-gallery-tab" data-gallery-action="global-source" data-source="${key}" aria-checked="${settings.global.source === key}">${label}</button>`).join('')}</div>
      <small class="pm-gallery-hint">接口地址、Key、画师串在下方「生图方案 → 全局方案」里填写</small></section>
    <section class="pm-gallery-section">
      ${toggle('enabled', '启用生图', '关闭后，图片消息与配图仅显示文字描述')}
      ${toggle('chatAuto', '聊天图片自动生成', '收到图片消息时自动出图；关闭时需手动点击「生成图片」')}
      ${toggle('communityAuto', '社区配图自动生成', '新帖带配图描述时自动出图')}
      ${toggle('videoAuto', '视频配图自动生成', '新视频的封面与分镜自动出图')}
    </section>
    <section class="pm-gallery-section"><b class="pm-gallery-section-title">各模块使用的方案</b>${moduleRows}</section>
    <section class="pm-gallery-section"><b class="pm-gallery-section-title">生图方案</b><ul class="pm-gallery-people is-plain">${profileRows}</ul>
      <button type="button" class="pm-action-button is-full" data-gallery-action="new-profile"${settings.presets.length >= IMAGE_PRESET_LIMIT ? ' disabled' : ''}>新建方案</button></section>
    <p class="pm-gallery-intro">数据库生图的地址与密钥在插件自己的设置里填写；这里可另选模型与画师串，留空沿用插件设置。内置 NAI 直接请求 NAI，提示词由手机API生成。图片保存在酒馆的 user/images/tianyin-phone 文件夹。</p>
  </div>
</div>`;
}

function field(label, control) {
    return `<label class="pm-gallery-field"><span>${label}</span>${control}</label>`;
}
const segment = (name, labels, selected) => `<div class="pm-gallery-tabs" role="radiogroup" data-profile-segment="${name}">${Object.entries(labels).map(([key, label]) => `<button type="button" role="radio" class="pm-gallery-tab" data-value="${key}" aria-checked="${key === selected}">${label}</button>`).join('')}</div>`;
const options = (values, selected, labels = {}) => values.map(value => `<option value="${escapeAttr(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(labels[value] || value)}</option>`).join('');

export function openProfileEditor(profileId, { makeOverlay, closeOverlay, onSaved }) {
    const settings = loadImageSettings();
    const isGlobal = profileId === GLOBAL_PROFILE_ID;
    const isNew = profileId === 'new';
    const profile = isNew ? createPresetFrom(settings) : isGlobal ? settings.global : settings.presets.find(p => p.id === profileId);
    if (!profile) return;
    const nai = profile.nai;
    const models = NAI_OFFICIAL_MODELS.includes(nai.model) ? NAI_OFFICIAL_MODELS : [nai.model, ...NAI_OFFICIAL_MODELS];
    const overlay = makeOverlay(`<div class="pm-modal pm-modal-wide pm-gallery-dna" role="dialog" aria-modal="true" aria-labelledby="pm-gallery-profile-title">
  <div class="pm-modal-header"><span></span><b id="pm-gallery-profile-title">${isGlobal ? '全局方案' : isNew ? '新建方案' : escapeHtml(profile.name)}</b><button type="button" class="pm-modal-close" data-profile-action="close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll pm-gallery-dna-body">
    ${isGlobal ? '' : field('方案名称', `<input class="pm-gallery-input" data-profile-field="name" maxlength="30" value="${escapeAttr(profile.name)}">`)}
    <div class="pm-gallery-field"><span>出图来源</span>${segment('source', IMAGE_SOURCE_LABELS, profile.source)}</div>
    <div class="pm-gallery-field"><span>图片比例</span>${segment('ratio', IMAGE_RATIO_LABELS, profile.ratio)}</div>
    <div class="pm-gallery-subform" data-profile-for="dbgen"${profile.source === 'dbgen' ? '' : ' hidden'}>
      ${field('模型（留空用插件设置）', `<input class="pm-gallery-input" data-profile-field="model" maxlength="120" spellcheck="false" placeholder="例如：nai-diffusion-4-5-full" value="${escapeAttr(profile.model)}">`)}
    </div>
    <div class="pm-gallery-subform" data-profile-for="nai"${profile.source === 'nai' ? '' : ' hidden'}>
      ${field('接口地址（留空用 NAI 官网）', `<input class="pm-gallery-input" data-profile-field="nai.endpoint" maxlength="500" spellcheck="false" inputmode="url" placeholder="https://image.novelai.net" value="${escapeAttr(nai.endpoint)}">`)}
      ${field('Key', `<input class="pm-gallery-input" type="password" autocomplete="off" data-profile-field="nai.apiKey" maxlength="500" spellcheck="false" value="${escapeAttr(nai.apiKey)}">`)}
      ${field('传输方式', `<select class="pm-gallery-input" data-profile-field="nai.transport">${options(NAI_TRANSPORTS, nai.transport, TRANSPORT_LABELS)}</select>`)}
      ${field('模型', `<select class="pm-gallery-input" data-profile-field="nai.model">${options(models, nai.model)}</select>`)}
      <div class="pm-gallery-field-row">
        ${field('步数', `<input class="pm-gallery-input" type="number" min="1" max="50" step="1" data-profile-field="nai.steps" value="${nai.steps}">`)}
        ${field('CFG', `<input class="pm-gallery-input" type="number" min="0" max="10" step="0.1" data-profile-field="nai.scale" value="${nai.scale}">`)}
      </div>
      ${field('采样器', `<select class="pm-gallery-input" data-profile-field="nai.sampler">${options(NAI_SAMPLERS, nai.sampler)}</select>`)}
      ${field('通用负面词', `<textarea data-profile-field="nai.negativePrompt" rows="3" spellcheck="false">${escapeHtml(nai.negativePrompt)}</textarea>`)}
    </div>
    ${field('画师串（正面）', `<textarea data-profile-field="artistPositive" rows="2" spellcheck="false" placeholder="留空用来源的默认画师">${escapeHtml(profile.artistPositive)}</textarea>`)}
    ${field('画师串（负面）', `<textarea data-profile-field="artistNegative" rows="2" spellcheck="false">${escapeHtml(profile.artistNegative)}</textarea>`)}
    <p class="pm-gallery-dna-status" role="status" aria-live="polite" hidden></p>
  </div>
  <div class="pm-gallery-dna-actions">
    ${isGlobal || isNew ? '' : '<button type="button" class="pm-action-button is-flex-1" data-profile-action="delete">删除</button>'}
    <button type="button" class="pm-action-button is-accent is-flex-1" data-profile-action="save">保存</button>
  </div>
</div>`);
    const status = overlay.querySelector('.pm-gallery-dna-status');
    const show = message => { status.hidden = !message; status.textContent = message; };
    const picked = name => overlay.querySelector(`[data-profile-segment="${name}"] [aria-checked="true"]`)?.dataset.value;
    const value = name => overlay.querySelector(`[data-profile-field="${name}"]`)?.value ?? '';
    let confirmDelete = false;
    overlay.querySelector('input, textarea, select, button.pm-gallery-tab')?.focus();
    overlay.addEventListener('click', event => {
        const option = event.target.closest('[data-profile-segment] [data-value]');
        if (option) {
            for (const sibling of option.parentElement.querySelectorAll('[data-value]')) sibling.setAttribute('aria-checked', String(sibling === option));
            if (option.parentElement.dataset.profileSegment === 'source') {
                for (const form of overlay.querySelectorAll('[data-profile-for]')) form.hidden = form.dataset.profileFor !== option.dataset.value;
            }
            return;
        }
        const button = event.target.closest('[data-profile-action]');
        if (!button) return;
        const action = button.dataset.profileAction;
        if (action === 'close') return closeOverlay('close');
        // 每次保存前重新读设置，避免覆盖别处刚改的内容。
        const current = loadImageSettings();
        if (action === 'delete') {
            if (!confirmDelete) { confirmDelete = true; show('删除后，使用此方案的模块改为跟随全局。再次点击以确认。'); return; }
            const modules = Object.fromEntries(Object.entries(current.modules).map(([key, id]) => [key, id === profileId ? GLOBAL_PROFILE_ID : id]));
            saveImageSettings({ ...current, presets: current.presets.filter(p => p.id !== profileId), modules });
            closeOverlay('close');
            return onSaved?.();
        }
        const next = normalizeImageProfile({
            id: profile.id, name: isGlobal ? '全局' : value('name') || profile.name,
            source: picked('source'), ratio: picked('ratio'), model: value('model'),
            artistPositive: value('artistPositive'), artistNegative: value('artistNegative'),
            nai: { endpoint: value('nai.endpoint'), apiKey: value('nai.apiKey'), transport: value('nai.transport'), model: value('nai.model'),
                steps: value('nai.steps'), scale: value('nai.scale'), sampler: value('nai.sampler'), negativePrompt: value('nai.negativePrompt') },
        }, { id: profile.id, name: profile.name });
        if (next.source === 'nai' && !next.nai.apiKey) return show('内置 NAI 需要填写 Key。');
        if (isGlobal) saveImageSettings({ ...current, global: next });
        else {
            const exists = current.presets.some(p => p.id === next.id);
            saveImageSettings({ ...current, presets: exists ? current.presets.map(p => p.id === next.id ? next : p) : [...current.presets, next] });
        }
        closeOverlay('close');
        onSaved?.();
    });
}
