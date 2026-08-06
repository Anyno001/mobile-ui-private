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
const createNode = () => ({
    listeners: new Map(), style: {}, value: '100',
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    trigger(type, event = {}) { return this.listeners.get(type)?.(event); },
});
const documentRef = {
    body: { appendChild(node) { activeOverlay = node; } },
    getElementById(id) { return id === 'pm-overlay' ? activeOverlay : null; },
    createElement(tag) {
        if (tag === 'canvas') return {
            getContext() { return { drawImage() {} }; },
            toDataURL() { return 'data:image/jpeg;base64,AA=='; },
        };
        if (tag !== 'div') return createNode();
        const nodes = {
            '#pm-crop-close': createNode(), '#pm-crop-cancel': createNode(), '#pm-crop-confirm': createNode(),
            '#pm-crop-frame': { ...createNode(), clientWidth: 330 },
            '#pm-crop-img': { ...createNode(), naturalWidth: 660, naturalHeight: 900 },
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
globalThis.window = windowRef;
globalThis.document = documentRef;
try {
    let cancelCount = 0;
    openCropper('data:image/png;base64,AA==', { onCancel: () => { cancelCount += 1; } });
    assert.deepEqual([...listenersByType.keys()].sort(), ['mousemove', 'mouseup', 'touchend', 'touchmove']);
    for (const type of listenersByType.keys()) assert.equal(listenerCount(type), 1);
    activeOverlay.querySelector('#pm-crop-cancel').trigger('click');
    assert.equal(cancelCount, 1, '取消裁剪必须仅回调一次');
    for (const type of listenersByType.keys()) assert.equal(listenerCount(type), 0, '取消后不得残留全局拖拽监听');

    let confirmed = '';
    openCropper('data:image/png;base64,AA==', { onConfirm: output => { confirmed = output; } });
    activeOverlay.querySelector('#pm-crop-confirm').trigger('click');
    assert.equal(confirmed, 'data:image/jpeg;base64,AA==', '确认裁剪必须回传生成结果');
    for (const type of listenersByType.keys()) assert.equal(listenerCount(type), 0, '确认后不得残留全局拖拽监听');
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
}
console.log('Cropper checks passed.');
