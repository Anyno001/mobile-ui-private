import { escapeAttr, escapeHtml } from './ui.js';

const SUB_OVERLAY_STYLE = 'position:fixed !important; inset:0 !important; margin:0 !important; padding:0 !important; border:none !important; width:100vw !important; height:100vh !important; max-width:none !important; max-height:none !important; background:rgba(0,0,0,.45) !important; z-index:2147483648 !important; display:flex !important; align-items:center !important; justify-content:center !important;';

function createSubOverlay(html) {
    document.getElementById('pm-overlay-sub')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pm-overlay-sub';
    if (typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover')) {
        overlay.setAttribute('popover', 'manual');
    }
    overlay.style.cssText = SUB_OVERLAY_STYLE;
    overlay.innerHTML = html;
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    if (overlay.showPopover) try { overlay.showPopover(); } catch (error) {}
    return overlay;
}

function renderPickerImages(set) {
    if (!set?.images?.length) return '<div style="text-align:center;color:#999;font-size:12px;padding:20px 0;">本套暂无图片</div>';
    return set.images.map((image, index) => `
        <div onclick="window.__pmInsertEmoji('[emo:${escapeAttr(set.name)}:${index + 1}]')" style="cursor:pointer;width:60px;display:flex;flex-direction:column;align-items:center;gap:4px;">
            <img src="${escapeAttr(image.url)}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
            <span style="font-size:10px;color:#666;width:100%;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(image.desc)}</span>
        </div>`).join('');
}

function renderPickerDots(sets, activeIndex) {
    if (sets.length <= 1) return '';
    return `<div style="display:flex;justify-content:center;gap:8px;padding:8px 0 4px;">${sets.map((set, index) => `<div class="pm-emoji-set-dot-btn" onclick="window.__pmEmojiSetDot(${index})" style="width:8px;height:8px;border-radius:50%;cursor:pointer;background:${index === activeIndex ? '#007aff' : '#ddd'};transition:background 0.2s;"></div>`).join('')}</div>`;
}

export function installEmojiUi({ makeOverlay, saveEmojis }) {
    async function mutateEmojis(mutator) {
        const snapshot = JSON.parse(JSON.stringify(window.__pmEmojis));
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
<div class="pm-modal pm-modal-wide" style="height:560px;">
  <div class="pm-modal-header"><b>表情包管理</b><span onclick="window.__pmCloseOverlay()" class="pm-modal-close">✕</span></div>
  <div class="pm-modal-scroll" style="padding:14px 16px;">
    <div id="pm-emoji-set-list"></div>
    <button onclick="window.__pmAddEmojiSet()" style="width:100%;margin-top:8px;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">添加新套组</button>
    <div class="pm-cfg-tip" style="text-align:left;margin-top:6px;">每套表情独立管理；图片描述会提供给 AI 判断使用场景。</div>
  </div>
</div>`);
        window.__pmRenderEmojiSetList();
    };

    window.__pmRenderEmojiSetList = () => {
        const container = document.getElementById('pm-emoji-set-list');
        if (!container) return;
        const sets = window.__pmEmojis;
        if (!sets.length) {
            container.innerHTML = '<div style="text-align:center;color:#aaa;font-size:13px;padding:16px 0;">暂无表情包套组</div>';
            return;
        }

        container.innerHTML = sets.map((set, setIndex) => `
            <div style="background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <span style="font-weight:600;font-size:13px;color:#222;">${escapeHtml(set.name)}</span>
                    <div style="display:flex;gap:6px;">
                        <button onclick="window.__pmAddEmojiImage(${setIndex})" style="font-size:11px;background:#007aff;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;">➕图片</button>
                        <button onclick="window.__pmDeleteEmojiSet(${setIndex})" style="font-size:11px;background:#ff3b30;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;">删除</button>
                    </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${set.images.map((image, imageIndex) => `
                        <div style="position:relative;width:52px;">
                            <img src="${escapeAttr(image.url)}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid #eee;">
                            <div style="font-size:9px;color:#888;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:52px;">${escapeHtml(image.desc)}</div>
                            <span onclick="window.__pmDeleteEmojiImage(${setIndex},${imageIndex})" style="position:absolute;top:-4px;right:-4px;background:#ff3b30;color:#fff;border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;">×</span>
                        </div>`).join('')}
                    ${set.images.length === 0 ? '<span style="font-size:12px;color:#aaa;">暂无图片</span>' : ''}
                </div>
                <div style="font-size:11px;color:#aaa;margin-top:4px;">${set.images.length}/20 张 · [emo:${escapeHtml(set.name)}:1~${set.images.length}]</div>
            </div>`).join('');
    };

    window.__pmAddEmojiSet = () => {
        if (window.__pmEmojis.length >= 10) return alert('最多只能创建 10 个套组。');
        createSubOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><b>新建表情包套组</b><span onclick="document.getElementById('pm-overlay-sub').remove()" class="pm-modal-close">✕</span></div>
  <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
    <input id="pm-new-set-name" class="pm-cfg-input" placeholder="套组名称（如：开心、日常、可爱）" style="padding:8px 10px;font-size:13px;border-radius:8px;border:1px solid #ddd;">
  </div>
  <div class="pm-modal-add"><button onclick="window.__pmConfirmAddEmojiSet()" style="width:100%;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">确认</button></div>
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
  <div class="pm-modal-header"><b>添加图片 — ${escapeHtml(set.name)}</b><span onclick="document.getElementById('pm-overlay-sub').remove();" class="pm-modal-close">✕</span></div>
  <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
    <div style="font-size:12px;color:#888;margin-bottom:2px;">图片 URL 或本地上传</div>
    <input id="pm-emo-url" class="pm-cfg-input" placeholder="https://... 或点下方选择文件" style="padding:8px 10px;font-size:13px;border-radius:8px;border:1px solid #ddd;">
    <button onclick="document.getElementById('pm-emo-file').click()" style="background:#f0f0f3;color:#333;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer;">📁 上传本地图片</button>
    <input id="pm-emo-file" type="file" accept="image/*" hidden onchange="window.__pmEmoFileRead(${setIndex},this)">
    <div id="pm-emo-preview" style="display:none;text-align:center;"><img id="pm-emo-preview-img" style="max-width:120px;max-height:120px;border-radius:10px;border:1px solid #eee;"></div>
    <input id="pm-emo-desc" class="pm-cfg-input" placeholder="图片描述（必填，如：猫猫开心）" style="padding:8px 10px;font-size:13px;border-radius:8px;border:1px solid #ddd;">
    <div style="font-size:11px;color:#aaa;">描述将告诉 AI 这张图在什么情形下使用</div>
  </div>
  <div class="pm-modal-add"><button onclick="window.__pmConfirmAddEmojiImage(${setIndex})" style="width:100%;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">确认添加</button></div>
</div>`);
        setTimeout(() => document.getElementById('pm-emo-url')?.focus(), 10);
    };

    window.__pmEmoFileRead = (setIndex, input) => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = event => {
            const url = event.target.result;
            const urlInput = document.getElementById('pm-emo-url');
            const preview = document.getElementById('pm-emo-preview');
            const previewImage = document.getElementById('pm-emo-preview-img');
            if (urlInput) urlInput.value = url;
            if (preview && previewImage) {
                previewImage.src = url;
                preview.style.display = 'block';
            }
        };
        reader.readAsDataURL(file);
    };

    window.__pmConfirmAddEmojiImage = async setIndex => {
        const url = document.getElementById('pm-emo-url')?.value.trim();
        const description = document.getElementById('pm-emo-desc')?.value.trim();
        if (!url) return alert('请输入图片 URL 或上传图片。');
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

        const renderPicker = () => {
            const set = sets[activeSetIndex] || sets[0];
            const picker = document.getElementById('pm-emoji-picker-inner');
            if (!set || !picker) return;
            picker.querySelector('.pm-emoji-set-label').textContent = `${set.name} (${set.images.length})`;
            picker.querySelector('.pm-emoji-imgs').innerHTML = renderPickerImages(set);
            picker.querySelector('.pm-emoji-dots').innerHTML = renderPickerDots(sets, activeSetIndex);
        };
        window.__pmEmojiSetDot = index => {
            activeSetIndex = index;
            renderPicker();
        };

        const firstSet = sets[0];
        makeOverlay(`
<div class="pm-modal pm-modal-wide" id="pm-emoji-picker-inner">
  <div class="pm-modal-header" style="justify-content:space-between;padding-right:14px;">
    <b class="pm-emoji-set-label">${escapeHtml(firstSet.name)} (${firstSet.images.length})</b>
    <span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span>
  </div>
  <div class="pm-emoji-imgs" id="pm-emoji-imgs-area" style="padding:12px 14px;overflow-y:auto;max-height:340px;display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-start;touch-action:pan-y pinch-zoom;">${renderPickerImages(firstSet)}</div>
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
