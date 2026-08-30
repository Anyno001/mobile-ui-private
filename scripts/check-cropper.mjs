import assert from 'node:assert/strict';
import { openCropper } from '../src/cropper.js';

const listenersByType = new Map();
const listenerCount = type => listenersByType.get(type)?.size || 0;
const windowRef = {
    addEventListener(type, listener) {
        if (!listenersByType.has(type)) listenersByType.set(type, new Set());
        listenersByType.get(type).add(listener);
    },
    removeEventListener(type, listener) { listenersByType.get(type)?.delete(listener); },
};
let activeOverlay = null;
const revokedObjectUrls = [];
const canvasSizesAfterConfirm = [];
const canvasDrawCalls = [];
let activeImage = null;
const createNode = () => ({
    listeners: new Map(), style: {}, value: '100',
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    trigger(type, event = {}) { return this.listeners.get(type)?.(event); },
});
const documentRef = {
    body: { appendChild(node) { activeOverlay = node; } },
    getElementById(id) { return id === 'pm-overlay' ? activeOverlay : null; },
    createElement(tag) {
        if (tag === 'canvas') {
            const canvas = {
                width: 0, height: 0,
                getContext() { return { drawImage(...args) { canvasDrawCalls.push(args); } }; },
                toDataURL(mime) { return `data:${mime};base64,AA==`; },
            };
            canvasSizesAfterConfirm.push(canvas);
            return canvas;
        }
        if (tag !== 'div') return createNode();
        const nodes = {
            '#pm-crop-close': createNode(), '#pm-crop-cancel': createNode(), '#pm-crop-confirm': createNode(),
            '#pm-crop-frame': { ...createNode(), clientWidth: 330 },
            '#pm-crop-img': activeImage = { ...createNode(), naturalWidth: 660, naturalHeight: 900 },
            '#pm-crop-zoom': createNode(),
        };
        return {
            style: {}, innerHTML: '',
            addEventListener(type, listener) { this.listeners ??= new Map(); this.listeners.set(type, listener); },
            querySelector(selector) { return nodes[selector] || null; },
            remove() { if (activeOverlay === this) activeOverlay = null; },
        };
    },
};
const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
const previousUrl = globalThis.URL;
globalThis.window = windowRef;
globalThis.document = documentRef;
globalThis.URL = { revokeObjectURL(url) { revokedObjectUrls.push(url); } };
try {
    let cancelCount = 0;
    openCropper('data:image/png;base64,AA==', { onCancel: () => { cancelCount += 1; } });
    assert.match(activeOverlay.innerHTML, /裁剪图片/);
    assert.match(activeOverlay.innerHTML, /拖动图片调整位置，滚轮\/捏合缩放/);
    assert.deepEqual([...listenersByType.keys()].sort(), ['mousemove', 'mouseup', 'touchend', 'touchmove']);
    for (const type of listenersByType.keys()) assert.equal(listenerCount(type), 1);
    activeOverlay.querySelector('#pm-crop-cancel').trigger('click');
    assert.equal(cancelCount, 1, '取消裁剪必须仅回调一次');
    for (const type of listenersByType.keys()) assert.equal(listenerCount(type), 0, '取消后不得残留全局拖拽监听');

    let confirmed = '';
    openCropper('blob:crop-source', { objectUrl: 'blob:crop-source', onConfirm: output => { confirmed = output; } });
    activeImage.onload();
    activeOverlay.querySelector('#pm-crop-confirm').trigger('click');
    assert.equal(confirmed, 'data:image/jpeg;base64,AA==', '确认裁剪必须回传生成结果');
    assert.deepEqual(revokedObjectUrls, ['blob:crop-source'], '确认裁剪后必须撤销上传文件 object URL');
    assert.deepEqual([canvasSizesAfterConfirm.at(-1).width, canvasSizesAfterConfirm.at(-1).height], [0, 0], '确认裁剪后必须释放 Canvas backing store');
    for (const type of listenersByType.keys()) assert.equal(listenerCount(type), 0, '确认后不得残留全局拖拽监听');
    assert.deepEqual(canvasSizesAfterConfirm.at(-1).width, 0, '默认 JPEG canvas 必须释放');

    assert.throws(() => openCropper('data:image/png;base64,AA==', { ratio: 0 }), /裁剪比例/);
    assert.throws(() => openCropper('data:image/png;base64,AA==', { outputWidth: 0 }), /输出宽度/);
    assert.throws(() => openCropper('data:image/png;base64,AA==', { mime: 'image/gif' }), /输出 MIME/);
    assert.throws(() => openCropper('data:image/png;base64,AA==', { fit: 'stretch' }), /适配方式/);

    let iconOutput = '';
    activeImage = null;
    openCropper('data:image/png;base64,CC==', {
        ratio: '1:1', outputWidth: 256, outputHeight: 256, mime: 'image/png',
        fit: 'contain', preserveTransparency: true,
        title: '设置图标', tip: '调整图标位置', confirmText: '使用图标',
        onConfirm: output => { iconOutput = output; },
    });
    assert.match(activeOverlay.innerHTML, /设置图标/);
    assert.match(activeOverlay.innerHTML, /调整图标位置/);
    assert.match(activeOverlay.innerHTML, /使用图标/);
    activeImage.naturalWidth = 1000;
    activeImage.naturalHeight = 100;
    activeImage.onload();
    activeOverlay.querySelector('#pm-crop-confirm').trigger('click');
    assert.equal(iconOutput, 'data:image/png;base64,AA==', '图标模式必须输出透明 PNG');
    assert.deepEqual([canvasSizesAfterConfirm.at(-1).width, canvasSizesAfterConfirm.at(-1).height], [0, 0], 'PNG 确认后必须释放 Canvas backing store');
    const containDraw = canvasDrawCalls.at(-1);
    assert.equal(containDraw.length, 5, 'contain 必须使用完整图片的目标矩形绘制，而非裁剪源区域');
    assert.ok(containDraw[4] < 256, 'contain 细长图片应在输出画布中保留垂直留白，不得强制 cover 裁切');
    activeOverlay?.__pmOnClose?.('phone-close');
    assert.equal(confirmed, 'data:image/jpeg;base64,AA==', '确认后的重复关闭不得重复回调');

    openCropper('data:image/png;base64,AA==', { onCancel: () => { cancelCount += 1; } });
    openCropper('data:image/png;base64,BB==', { onCancel: () => { cancelCount += 1; } });
    for (const type of listenersByType.keys()) assert.equal(listenerCount(type), 1, '替换裁剪器不得累计旧监听');
    activeOverlay.__pmOnClose?.('phone-close');
    for (const type of listenersByType.keys()) assert.equal(listenerCount(type), 0, '统一 Overlay 关闭必须释放裁剪器监听');
    assert.equal(cancelCount, 1, '外部关闭裁剪器不得误触用户取消回调');
} finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousUrl === undefined) delete globalThis.URL; else globalThis.URL = previousUrl;
}
console.log('Cropper checks passed.');
