import { POPOVER_SUPPORTED } from './constants.js';
import { escapeAttr } from './ui.js';

export function openCropper(imgDataUrl, { onCancel, onConfirm }) {
    const ratio = 330 / 450;
    document.getElementById('pm-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pm-overlay';
    if (POPOVER_SUPPORTED) overlay.setAttribute('popover', 'manual');
    overlay.innerHTML = `
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header"><b>裁剪图片</b><span id="pm-crop-close" class="pm-modal-close">✕</span></div>
  <div style="padding:12px 14px;">
    <div class="pm-crop-tip">拖动图片调整位置，滚轮/捏合缩放</div>
    <div class="pm-crop-frame" id="pm-crop-frame">
      <img id="pm-crop-img" src="${escapeAttr(imgDataUrl)}" alt="">
      <div class="pm-crop-mask"></div>
    </div>
    <div class="pm-crop-zoom">
      <span style="font-size:11px;color:#888;">缩放</span>
      <input type="range" id="pm-crop-zoom" min="100" max="400" value="100">
    </div>
  </div>
  <div class="pm-modal-add" style="display:flex;gap:8px;">
    <button id="pm-crop-cancel" style="flex:1;background:#f0f0f0;color:#333;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;">取消</button>
    <button id="pm-crop-confirm" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">确认裁剪</button>
  </div>
</div>`;

    const cancel = () => {
        overlay.remove();
        onCancel?.();
    };
    overlay.querySelector('#pm-crop-close').addEventListener('click', cancel);
    overlay.querySelector('#pm-crop-cancel').addEventListener('click', cancel);
    overlay.addEventListener('click', event => { if (event.target === overlay) cancel(); });
    document.body.appendChild(overlay);
    if (overlay.showPopover) try { overlay.showPopover(); } catch (error) {}

    const frame = overlay.querySelector('#pm-crop-frame');
    const image = overlay.querySelector('#pm-crop-img');
    const zoomSlider = overlay.querySelector('#pm-crop-zoom');
    let tx = 0, ty = 0, scale = 1;
    let frameWidth = 0, frameHeight = 0, baseWidth = 0, baseHeight = 0;

    function updateTransform() {
        const width = baseWidth * scale;
        const height = baseHeight * scale;
        tx = Math.max(frameWidth - width, Math.min(0, tx));
        ty = Math.max(frameHeight - height, Math.min(0, ty));
        image.style.width = width + 'px';
        image.style.height = height + 'px';
        image.style.transform = `translate(${tx}px, ${ty}px)`;
    }

    image.onload = () => {
        frameWidth = frame.clientWidth;
        frameHeight = frameWidth / ratio;
        frame.style.height = frameHeight + 'px';
        const imageRatio = image.naturalWidth / image.naturalHeight;
        if (imageRatio > ratio) {
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
        const outputWidth = 600;
        const outputHeight = Math.round(outputWidth / ratio);
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext('2d');
        const sourceScale = image.naturalWidth / (baseWidth * scale);
        context.drawImage(
            image,
            -tx * sourceScale,
            -ty * sourceScale,
            frameWidth * sourceScale,
            frameHeight * sourceScale,
            0,
            0,
            outputWidth,
            outputHeight,
        );
        let quality = 0.7;
        let output = canvas.toDataURL('image/jpeg', quality);
        while (output.length > 200 * 1370 && quality > 0.2) {
            quality -= 0.1;
            output = canvas.toDataURL('image/jpeg', quality);
        }
        overlay.remove();
        onConfirm(output);
    });
}
