import { THEME_PRESETS } from './config.js';
import { contrastText, escapeAttr, escapeHtml } from './ui.js';
import { CLOSE_ICON_SVG } from './icons.js';
import {
    cloneEmojiLibrary, createEmojiRenderBudget, emojiFileError, emojiSourceError,
} from './emoji-media.js';

function applySubOverlayTheme(overlay) {
    const theme = window.__pmTheme || {};
    const preset = THEME_PRESETS[theme.preset] || THEME_PRESETS.default;
    // 与 applyTheme 保持同一语义：苹果皮肤是独立浅色界面，不继承暗色骨架变量。
    const interfaceMode = theme.preset === 'apple' ? 'light' : (theme.darkMode || 'light');
    const customAccent = theme.preset === 'custom' ? String(theme.customAccent || '').trim() : '';
    const defaultRight = theme.preset === 'custom' && customAccent ? customAccent : interfaceMode === 'dark' ? preset.rightDark || preset.right : preset.right;
    const defaultLeft = interfaceMode === 'dark' ? preset.leftDark || preset.left : preset.left;
    const rightBackground = theme.customRight || defaultRight;
    const rightText = theme.customRight || (theme.preset === 'custom' && customAccent)
        ? contrastText(rightBackground) : preset.rightText;
    const skinTokens = { ...THEME_PRESETS.apple?.ui, ...THEME_PRESETS.pink?.uiDark };
    const uiTokens = interfaceMode === 'dark' ? preset.uiDark || {} : preset.ui || {};
    overlay.style.setProperty('--pm-r-bg', rightBackground);
    overlay.style.setProperty('--pm-r-txt', rightText);
    overlay.style.setProperty('--pm-l-bg', theme.customLeft || defaultLeft);
    overlay.style.setProperty('--pm-l-txt', theme.customLeft ? contrastText(theme.customLeft) : interfaceMode === 'dark' ? preset.leftTextDark || preset.leftText : preset.leftText);
    overlay.style.setProperty('--pm-border', theme.borderColor || '#1a1a1a');
    overlay.style.setProperty('--pm-color-accent', customAccent || preset.accent || preset.right);
    for (const token of Object.keys(skinTokens)) overlay.style.removeProperty(token);
    for (const [token, value] of Object.entries(uiTokens)) overlay.style.setProperty(token, value);
    overlay.dataset.theme = interfaceMode;
    if (theme.preset === 'apple') overlay.dataset.skin = 'apple';
    else delete overlay.dataset.skin;
}

function createSubOverlay(html) {
    document.getElementById('pm-overlay-sub')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pm-overlay-sub';
    overlay.className = 'pm-sub-overlay';
    overlay.dataset.theme = window.__pmTheme?.darkMode || 'light';
    if (typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover')) {
        overlay.setAttribute('popover', 'manual');
    }
    applySubOverlayTheme(overlay);
    overlay.innerHTML = html;
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    if (overlay.showPopover) try { overlay.showPopover(); } catch (error) {}
    return overlay;
}

function renderEmojiThumbnail(image, width, height, canRender) {
    const sizeClass = `is-${width}x${height}`;
    if (!canRender(image.url)) {
        return `<div class="pm-emoji-thumbnail is-placeholder ${sizeClass}">图片暂不加载</div>`;
    }
    return `<img class="pm-emoji-thumbnail ${sizeClass}" src="${escapeAttr(image.url)}" loading="lazy" decoding="async" width="${width}" height="${height}">`;
}

function renderPickerImages(set, canRender = createEmojiRenderBudget()) {
    if (!set?.images?.length) return '<div class="pm-emoji-empty">本套暂无图片</div>';
    return set.images.map((image, index) => `
        <div class="pm-emoji-picker-item" onclick="window.__pmInsertEmoji('[emo:${escapeAttr(set.name)}:${index + 1}]')">
            ${renderEmojiThumbnail(image, 50, 50, canRender)}
            <span>${escapeHtml(image.desc)}</span>
        </div>`).join('');
}

function renderPickerDots(sets, activeIndex) {
    if (sets.length <= 1) return '';
    return `<div class="pm-emoji-picker-dots">${sets.map((set, index) => `<div class="pm-emoji-set-dot-btn${index === activeIndex ? ' is-active' : ''}" onclick="window.__pmEmojiSetDot(${index})"></div>`).join('')}</div>`;
}

export function installEmojiUi({ makeOverlay, saveEmojis }) {
    async function mutateEmojis(mutator) {
        const snapshot = cloneEmojiLibrary(window.__pmEmojis);
        try {
            mutator();
            await saveEmojis();
        } catch (error) {
            window.__pmEmojis = snapshot;
            throw error;
        }
    }

    window.__pmShowEmojiManager = () => {
        makeOverlay(`
<div class="pm-modal pm-modal-wide pm-emoji-manager-modal">
  <div class="pm-modal-header"><span></span><b>表情包管理</b><button type="button" onclick="window.__pmCloseOverlay()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll pm-emoji-manager-body">
    <div id="pm-emoji-set-list"></div>
    <button type="button" class="pm-emoji-action is-full" onclick="window.__pmAddEmojiSet()">添加新套组</button>
    <div class="pm-cfg-tip">每套表情独立管理；图片描述会提供给 AI 判断使用场景。</div>
  </div>
</div>`);
        window.__pmRenderEmojiSetList();
    };

    window.__pmRenderEmojiSetList = () => {
        const container = document.getElementById('pm-emoji-set-list');
        if (!container) return;
        const sets = window.__pmEmojis;
        if (!sets.length) {
            container.innerHTML = '<div class="pm-emoji-empty">暂无表情包套组</div>';
            return;
        }
        const canRender = createEmojiRenderBudget();

        container.innerHTML = sets.map((set, setIndex) => `
            <div class="pm-emoji-set-card">
                <div class="pm-emoji-set-header">
                    <span class="pm-emoji-set-title">${escapeHtml(set.name)}</span>
                    <div class="pm-emoji-set-actions">
                        <button type="button" class="pm-emoji-action is-compact" onclick="window.__pmAddEmojiImage(${setIndex})">添加图片</button>
                        <button type="button" class="pm-emoji-action is-compact is-danger" onclick="window.__pmDeleteEmojiSet(${setIndex})">删除</button>
                    </div>
                </div>
                <div class="pm-emoji-set-images">
                    ${set.images.map((image, imageIndex) => `
                        <div class="pm-emoji-set-image">
                            ${renderEmojiThumbnail(image, 52, 52, canRender)}
                            <div class="pm-emoji-set-image-label">${escapeHtml(image.desc)}</div>
                            <button type="button" class="pm-emoji-image-delete" onclick="window.__pmDeleteEmojiImage(${setIndex},${imageIndex})" aria-label="删除图片 ${escapeAttr(image.desc)}">删除</button>
                        </div>`).join('')}
                    ${set.images.length === 0 ? '<span class="pm-emoji-empty">暂无图片</span>' : ''}
                </div>
                <div class="pm-emoji-set-meta">${set.images.length}/20 张 · [emo:${escapeHtml(set.name)}:1~${set.images.length}]</div>
            </div>`).join('');
    };

    window.__pmAddEmojiSet = () => {
        if (window.__pmEmojis.length >= 10) return alert('最多只能创建 10 个套组。');
        createSubOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><span></span><b>新建表情包套组</b><button type="button" onclick="document.getElementById('pm-overlay-sub').remove()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-emoji-form">
    <input id="pm-new-set-name" class="pm-cfg-input" placeholder="套组名称（如：开心、日常、可爱）">
  </div>
  <div class="pm-modal-add"><button type="button" class="pm-action-button is-accent" data-layout="full" onclick="window.__pmConfirmAddEmojiSet()">确认</button></div>
</div>`);
        setTimeout(() => document.getElementById('pm-new-set-name')?.focus(), 10);
    };

    window.__pmConfirmAddEmojiSet = async () => {
        const name = document.getElementById('pm-new-set-name')?.value.trim();
        if (!name) return alert('套组名称不能为空。');
        if (window.__pmEmojis.some(set => set.name === name)) return alert('该名称已存在。');
        try {
            await mutateEmojis(() => window.__pmEmojis.push({ id: 'emo_' + Date.now(), name, images: [] }));
            document.getElementById('pm-overlay-sub')?.remove();
            window.__pmRenderEmojiSetList();
        } catch (error) {
            alert(error.message || '表情包保存失败');
        }
    };

    window.__pmDeleteEmojiSet = async setIndex => {
        const set = window.__pmEmojis[setIndex];
        if (!set || !confirm(`确认删除套组「${set.name}」？`)) return;
        try {
            await mutateEmojis(() => window.__pmEmojis.splice(setIndex, 1));
            window.__pmRenderEmojiSetList();
        } catch (error) {
            alert(error.message || '表情包保存失败');
        }
    };


    window.__pmAddEmojiImage = setIndex => {
        const set = window.__pmEmojis[setIndex];
        if (!set) return;
        if (set.images.length >= 20) return alert('本套组已满 20 张。');
        createSubOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><span></span><b>添加图片 — ${escapeHtml(set.name)}</b><button type="button" onclick="document.getElementById('pm-overlay-sub').remove();" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-emoji-form">
    <div class="pm-cfg-label">图片 URL 或本地上传</div>
    <input id="pm-emo-url" class="pm-cfg-input" placeholder="https://... 或点下方选择文件">
    <button type="button" class="pm-emoji-upload" onclick="document.getElementById('pm-emo-file').click()">上传本地图片</button>
    <input id="pm-emo-file" type="file" accept="image/*" hidden onchange="window.__pmEmoFileRead(${setIndex},this)">
    <div id="pm-emo-preview" class="pm-emoji-preview"><img id="pm-emo-preview-img" decoding="async" width="120" height="120"></div>
    <input id="pm-emo-desc" class="pm-cfg-input" placeholder="图片描述（必填，如：猫猫开心）">
    <div class="pm-cfg-tip">描述将告诉 AI 这张图在什么情形下使用</div>
  </div>
  <div class="pm-modal-add"><button type="button" class="pm-action-button is-accent" data-layout="full" onclick="window.__pmConfirmAddEmojiImage(${setIndex})">确认添加</button></div>
</div>`);
        setTimeout(() => document.getElementById('pm-emo-url')?.focus(), 10);
    };

    window.__pmEmoFileRead = (setIndex, input) => {
        const file = input.files?.[0];
        if (!file) return;
        const validationError = emojiFileError(file);
        if (validationError) {
            input.value = '';
            alert(validationError);
            return;
        }
        const reader = new FileReader();
        reader.onload = event => {
            const url = event.target.result;
            const urlInput = document.getElementById('pm-emo-url');
            const preview = document.getElementById('pm-emo-preview');
            const previewImage = document.getElementById('pm-emo-preview-img');
            if (urlInput) urlInput.value = url;
            if (preview && previewImage) {
                previewImage.src = url;
                preview.classList.add('is-visible');
            }
        };
        reader.readAsDataURL(file);
    };

    window.__pmConfirmAddEmojiImage = async setIndex => {
        const url = document.getElementById('pm-emo-url')?.value.trim();
        const description = document.getElementById('pm-emo-desc')?.value.trim();
        const validationError = emojiSourceError(url, window.__pmEmojis);
        if (validationError) return alert(validationError);
        if (!description) return alert('请输入图片描述（必填）。');
        const set = window.__pmEmojis[setIndex];
        if (!set) return;
        try {
            await mutateEmojis(() => window.__pmEmojis[setIndex].images.push({ url, desc: description }));
            document.getElementById('pm-overlay-sub')?.remove();
            window.__pmRenderEmojiSetList();
        } catch (error) {
            alert(error.message || '表情包保存失败');
        }
    };

    window.__pmDeleteEmojiImage = async (setIndex, imageIndex) => {
        const set = window.__pmEmojis[setIndex];
        if (!set) return;
        try {
            await mutateEmojis(() => window.__pmEmojis[setIndex].images.splice(imageIndex, 1));
            window.__pmRenderEmojiSetList();
        } catch (error) {
            alert(error.message || '表情包保存失败');
        }
    };

    window.__pmShowEmojiPicker = () => {
        const sets = window.__pmEmojis;
        if (!sets.length) {
            window.__pmShowEmojiManager();
            return;
        }
        const input = document.querySelector('.pm-input');
        window.__pmTempText = input ? input.value : '';
        let activeSetIndex = 0;
        let canRender = createEmojiRenderBudget();

        const renderPicker = () => {
            const set = sets[activeSetIndex] || sets[0];
            const picker = document.getElementById('pm-emoji-picker-inner');
            if (!set || !picker) return;
            canRender = createEmojiRenderBudget();
            picker.querySelector('.pm-emoji-set-label').textContent = `${set.name} (${set.images.length})`;
            picker.querySelector('.pm-emoji-imgs').innerHTML = renderPickerImages(set, canRender);
            picker.querySelector('.pm-emoji-dots').innerHTML = renderPickerDots(sets, activeSetIndex);
        };
        window.__pmEmojiSetDot = index => {
            activeSetIndex = index;
            renderPicker();
        };

        const firstSet = sets[0];
        makeOverlay(`
<div class="pm-modal pm-modal-wide" id="pm-emoji-picker-inner">
  <div class="pm-modal-header">
    <span></span>
    <b class="pm-emoji-set-label">${escapeHtml(firstSet.name)} (${firstSet.images.length})</b>
    <button type="button" onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button>
  </div>
  <div class="pm-emoji-imgs pm-emoji-picker-images" id="pm-emoji-imgs-area">${renderPickerImages(firstSet, canRender)}</div>
  <div class="pm-emoji-dots">${renderPickerDots(sets, 0)}</div>
</div>`);

        const imageArea = document.getElementById('pm-emoji-imgs-area');
        if (!imageArea || sets.length <= 1) return;
        let startX = 0, startY = 0, movedHorizontally = false;
        imageArea.addEventListener('touchstart', event => {
            startX = event.touches[0].clientX;
            startY = event.touches[0].clientY;
            movedHorizontally = false;
        }, { passive: true });
        imageArea.addEventListener('touchmove', event => {
            const dx = event.touches[0].clientX - startX;
            const dy = event.touches[0].clientY - startY;
            if (!movedHorizontally && Math.abs(dx) > Math.abs(dy) + 5) movedHorizontally = true;
            if (movedHorizontally && event.cancelable) event.preventDefault();
        }, { passive: false });
        imageArea.addEventListener('touchend', event => {
            const dx = event.changedTouches[0].clientX - startX;
            const dy = event.changedTouches[0].clientY - startY;
            if (Math.abs(dx) <= 40 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
            activeSetIndex = dx < 0
                ? (activeSetIndex + 1) % sets.length
                : (activeSetIndex - 1 + sets.length) % sets.length;
            renderPicker();
        }, { passive: true });
    };

    window.__pmInsertEmoji = code => {
        const text = window.__pmTempText || '';
        document.getElementById('pm-overlay')?.remove();
        const input = document.querySelector('.pm-input');
        if (!input) return;
        input.value = text + code + ' ';
        window.__pmTempText = input.value;
        input.focus();
        input.selectionStart = input.selectionEnd = input.value.length;
    };
}
