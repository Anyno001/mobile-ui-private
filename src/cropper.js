import { POPOVER_SUPPORTED } from './constants.js';
import { escapeAttr } from './ui.js';
import { CLOSE_ICON_SVG } from './icons.js';

const DEFAULT_CROPPER_OPTIONS = Object.freeze({
    title: '裁剪图片',
    tip: '拖动图片调整位置，滚轮/捏合缩放',
    confirmText: '确认裁剪',
    ratio: 330 / 450,
    outputWidth: 600,
    outputHeight: null,
    mime: 'image/jpeg',
    fit: 'cover',
    preserveTransparency: false,
    quality: Object.freeze({ initial: 0.7, min: 0.2, step: 0.1, maxLength: 200 * 1370 }),
});

const SUPPORTED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function normalizeRatio(value) {
    if (typeof value === 'string') {
        const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
        if (!match) throw new TypeError('裁剪比例必须是正数或“宽:高”格式');
        value = Number(match[1]) / Number(match[2]);
    }
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('裁剪比例必须是大于 0 的有限数');
    return value;
}

function normalizeDimension(value, name) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > 8192) {
        throw new RangeError(`${name}必须是 1 到 8192 之间的正整数`);
    }
    return value;
}

function normalizeOptions(options = {}) {
    if (!options || typeof options !== 'object') throw new TypeError('裁剪器配置必须是对象');
    const normalized = { ...DEFAULT_CROPPER_OPTIONS, ...options };
    normalized.ratio = normalizeRatio(normalized.ratio);
    normalized.outputWidth = normalizeDimension(normalized.outputWidth, '输出宽度');
    normalized.outputHeight = normalized.outputHeight == null
        ? Math.max(1, Math.round(normalized.outputWidth / normalized.ratio))
        : normalizeDimension(normalized.outputHeight, '输出高度');
    if (!SUPPORTED_MIMES.has(normalized.mime)) throw new TypeError(`不支持的输出 MIME：${normalized.mime}`);
    if (!['cover', 'contain'].includes(normalized.fit)) throw new TypeError(`不支持的图片适配方式：${normalized.fit}`);
    if (typeof normalized.preserveTransparency !== 'boolean') {
        throw new TypeError('preserveTransparency 必须是布尔值');
    }
    if (normalized.preserveTransparency && normalized.mime === 'image/jpeg') {
        throw new TypeError('保留透明度时不能输出 JPEG');
    }
    const quality = { ...DEFAULT_CROPPER_OPTIONS.quality, ...(normalized.quality || {}) };
    if (![quality.initial, quality.min, quality.step].every(Number.isFinite)
        || quality.initial <= 0 || quality.initial > 1 || quality.min <= 0 || quality.min > quality.initial
        || quality.step <= 0 || quality.step > quality.initial || !Number.isInteger(quality.maxLength) || quality.maxLength <= 0) {
        throw new RangeError('质量策略必须包含有效的 initial、min、step 和 maxLength');
    }
    normalized.quality = quality;
    for (const name of ['title', 'tip', 'confirmText']) {
        if (typeof normalized[name] !== 'string') throw new TypeError(`${name} 必须是字符串`);
    }
    return normalized;
}

export function openCropper(imgDataUrl, options = {}) {
    const optionBag = options === undefined ? {} : options;
    if (!optionBag || typeof optionBag !== 'object') throw new TypeError('裁剪器配置必须是对象');
    const { objectUrl = '', onCancel, onConfirm, ...cropperOptions } = optionBag;
    const { title, tip, confirmText, ratio, outputWidth, outputHeight, mime, fit, preserveTransparency, quality } = normalizeOptions(cropperOptions);
    const previousOverlay = document.getElementById('pm-overlay');
    if (typeof previousOverlay?.__pmCropperDispose === 'function') previousOverlay.__pmCropperDispose();
    else previousOverlay?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pm-overlay';
    if (POPOVER_SUPPORTED) overlay.setAttribute('popover', 'manual');
    overlay.innerHTML = `
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header"><span></span><b>${escapeAttr(title)}</b><button type="button" id="pm-crop-close" class="pm-modal-close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-crop-body">
    <div class="pm-crop-tip">${escapeAttr(tip)}</div>
    <div class="pm-crop-frame" id="pm-crop-frame">
      <img id="pm-crop-img" src="${escapeAttr(imgDataUrl)}" alt="">
      <div class="pm-crop-mask"></div>
    </div>
    <div class="pm-crop-zoom">
      <span class="pm-crop-zoom-label">缩放</span>
      <input type="range" id="pm-crop-zoom" min="100" max="400" value="100">
    </div>
  </div>
  <div class="pm-modal-add pm-crop-actions">
    <button id="pm-crop-cancel" class="pm-action-button is-secondary is-flex-1">取消</button>
    <button id="pm-crop-confirm" class="pm-action-button is-accent is-flex-1">${escapeAttr(confirmText)}</button>
  </div>
</div>`;

    const cancel = () => {
        if (dispose()) onCancel?.();
    };
    const frame = overlay.querySelector('#pm-crop-frame');
    const image = overlay.querySelector('#pm-crop-img');
    const zoomSlider = overlay.querySelector('#pm-crop-zoom');
    let tx = 0, ty = 0, scale = 1;
    let frameWidth = 0, frameHeight = 0, baseWidth = 0, baseHeight = 0;

    function updateTransform() {
        const width = baseWidth * scale;
        const height = baseHeight * scale;
        if (fit === 'contain' && width <= frameWidth) {
            tx = Math.max(0, Math.min(frameWidth - width, tx));
        } else {
            tx = Math.max(frameWidth - width, Math.min(0, tx));
        }
        if (fit === 'contain' && height <= frameHeight) {
            ty = Math.max(0, Math.min(frameHeight - height, ty));
        } else {
            ty = Math.max(frameHeight - height, Math.min(0, ty));
        }
        image.style.width = width + 'px';
        image.style.height = height + 'px';
        image.style.transform = `translate(${tx}px, ${ty}px)`;
    }

    image.onload = () => {
        frameWidth = frame.clientWidth;
        frameHeight = frameWidth / ratio;
        frame.style.height = frameHeight + 'px';
        const imageRatio = image.naturalWidth / image.naturalHeight;
        if (imageRatio <= 0 || !Number.isFinite(imageRatio)) {
            dispose();
            throw new Error('图片自然尺寸无效');
        }
        if (fit === 'contain') {
            if (imageRatio > ratio) {
                baseWidth = frameWidth;
                baseHeight = baseWidth / imageRatio;
            } else {
                baseHeight = frameHeight;
                baseWidth = baseHeight * imageRatio;
            }
            tx = (frameWidth - baseWidth) / 2;
            ty = (frameHeight - baseHeight) / 2;
        } else if (imageRatio > ratio) {
            baseHeight = frameHeight;
            baseWidth = baseHeight * imageRatio;
        } else {
            baseWidth = frameWidth;
            baseHeight = baseWidth / imageRatio;
        }
        updateTransform();
    };


    zoomSlider.oninput = () => {
        scale = parseInt(zoomSlider.value, 10) / 100;
        updateTransform();
    };

    let dragging = false, startX = 0, startY = 0, startTx = 0, startTy = 0;
    const onDragStart = event => {
        dragging = true;
        const point = event.touches ? event.touches[0] : event;
        startX = point.clientX;
        startY = point.clientY;
        startTx = tx;
        startTy = ty;
        if (event.cancelable) event.preventDefault();
    };
    const onDragMove = event => {
        if (!dragging) return;
        const point = event.touches ? event.touches[0] : event;
        tx = startTx + point.clientX - startX;
        ty = startTy + point.clientY - startY;
        updateTransform();
        if (event.cancelable) event.preventDefault();
    };
    const onDragEnd = () => { dragging = false; };
    frame.addEventListener('mousedown', onDragStart);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    frame.addEventListener('touchstart', onDragStart, { passive: false });
    window.addEventListener('touchmove', onDragMove, { passive: false });
    window.addEventListener('touchend', onDragEnd);

    let disposed = false;
    function dispose() {
        if (disposed) return false;
        disposed = true;
        image.onload = null;
        image.src = '';
        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
        window.removeEventListener('touchmove', onDragMove);
        window.removeEventListener('touchend', onDragEnd);
        overlay.remove();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return true;
    }
    overlay.__pmCropperDispose = dispose;
    overlay.__pmOnClose = dispose;
    overlay.querySelector('#pm-crop-close').addEventListener('click', cancel);
    overlay.querySelector('#pm-crop-cancel').addEventListener('click', cancel);
    overlay.addEventListener('click', event => { if (event.target === overlay) cancel(); });
    document.body.appendChild(overlay);
    if (overlay.showPopover) try { overlay.showPopover(); } catch (error) {}

    let pinchDistance = 0, pinchScale = 1;
    frame.addEventListener('touchstart', event => {
        if (event.touches.length !== 2) return;
        pinchDistance = Math.hypot(
            event.touches[0].clientX - event.touches[1].clientX,
            event.touches[0].clientY - event.touches[1].clientY,
        );
        pinchScale = scale;
    }, { passive: false });
    frame.addEventListener('touchmove', event => {
        if (event.touches.length !== 2 || !pinchDistance) return;
        const distance = Math.hypot(
            event.touches[0].clientX - event.touches[1].clientX,
            event.touches[0].clientY - event.touches[1].clientY,
        );
        scale = Math.max(1, Math.min(4, pinchScale * distance / pinchDistance));
        zoomSlider.value = Math.round(scale * 100);
        updateTransform();
        event.preventDefault();
    }, { passive: false });
    frame.addEventListener('wheel', event => {
        event.preventDefault();
        scale = Math.max(1, Math.min(4, scale + (event.deltaY > 0 ? -0.1 : 0.1)));
        zoomSlider.value = Math.round(scale * 100);
        updateTransform();
    });

    overlay.querySelector('#pm-crop-confirm').addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        try {
            canvas.width = outputWidth;
            canvas.height = outputHeight;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('浏览器无法创建图片裁剪画布');
            if (fit === 'contain') {
                const outputScale = outputWidth / frameWidth;
                context.drawImage(image, tx * outputScale, ty * outputScale,
                    baseWidth * scale * outputScale, baseHeight * scale * outputScale);
            } else {
                const sourceScale = image.naturalWidth / (baseWidth * scale);
                context.drawImage(image, -tx * sourceScale, -ty * sourceScale,
                    frameWidth * sourceScale, frameHeight * sourceScale, 0, 0, outputWidth, outputHeight);
            }
            let currentQuality = quality.initial;
            let output = canvas.toDataURL(mime, currentQuality);
            while (output.length > quality.maxLength && currentQuality > quality.min) {
                currentQuality = Math.max(quality.min, currentQuality - quality.step);
                output = canvas.toDataURL(mime, currentQuality);
            }
            if (!output.startsWith(`data:${mime};`)) throw new Error(`浏览器不支持输出 MIME：${mime}`);
            if (dispose()) onConfirm(output);
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    });
}
