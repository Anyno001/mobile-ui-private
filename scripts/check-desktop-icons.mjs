import assert from 'node:assert/strict';
import {
    createDesktopIconStorage, DESKTOP_ICON_IDS, DESKTOP_ICON_MAX_ITEM_BYTES, DESKTOP_ICON_MAX_TOTAL_BYTES,
    DESKTOP_ICON_RESOURCE_PREFIX, DESKTOP_ICON_STORAGE_KEY, isValidDesktopIconRuntimeData, normalizeDesktopIconBackupPayload,
} from '../src/desktop-icon-storage.js';
import { createDesktopIconSettings } from '../src/settings-desktop-icons.js';
import { renderPhoneDesktop, resolveDesktopAppIcon } from '../src/interactive-scene-views.js';

const png = size => `data:image/png;base64,${'A'.repeat(Math.ceil(size / 3) * 4)}`;
const valid = png(12);
const runtimeValid = 'data:image/png;base64,iVBORw0KGgoAAA==';
const metadata = { width: 256, height: 256 };
assert.deepEqual(normalizeDesktopIconBackupPayload({ chat: valid }), { chat: valid });
assert.throws(() => normalizeDesktopIconBackupPayload({ unknown: valid }), /未知图标/);
assert.throws(() => normalizeDesktopIconBackupPayload({ chat: 'data:image/jpeg;base64,AAAA' }), /Base64 PNG/);
assert.throws(() => normalizeDesktopIconBackupPayload({ chat: 'data:image/png;base64,***=' }), /Base64 PNG/);
assert.throws(() => normalizeDesktopIconBackupPayload({ chat: png(DESKTOP_ICON_MAX_ITEM_BYTES + 3) }), /单项容量/);
assert.throws(() => normalizeDesktopIconBackupPayload(Object.fromEntries(DESKTOP_ICON_IDS.map(id => [id, png(230 * 1024)]))), /总容量/);
assert.equal(isValidDesktopIconRuntimeData(runtimeValid), true);
assert.equal(isValidDesktopIconRuntimeData('data:image/png;base64,'), false);
assert.equal(isValidDesktopIconRuntimeData('data:image/png;base64,***='), false);
assert.equal(isValidDesktopIconRuntimeData(valid), false, '无 PNG 签名的伪资源必须拒绝');
assert.equal(isValidDesktopIconRuntimeData(png(DESKTOP_ICON_MAX_ITEM_BYTES + 3)), false);
const makeHarness = (initial = {}, failures = new Set()) => {
    const values = new Map(Object.entries(initial));
    const calls = [];
    const storage = createDesktopIconStorage({
        windowRef: {},
        idbRead: async key => ({ ok: true, value: values.get(key) }),
        idbWrite: async (key, value) => { calls.push(['write', key]); if (failures.has(`write:${key}`)) return false; values.set(key, structuredClone(value)); return true; },
        idbDelete: async key => { calls.push(['delete', key]); if (failures.has(`delete:${key}`)) return false; values.delete(key); return true; },
        logger: { warn() {} },
    });
    return { values, calls, storage };
};

const empty = makeHarness();
assert.deepEqual(await empty.storage.load(), {});
assert.equal(empty.values.has(DESKTOP_ICON_STORAGE_KEY), false);

const failedRead = createDesktopIconStorage({ idbRead: async () => ({ ok: false }), windowRef: {}, logger: { warn() {} } });
await assert.rejects(failedRead.load(), /清单读取失败/);

const future = makeHarness({ [DESKTOP_ICON_STORAGE_KEY]: { schemaVersion: 2, icons: {} } });
await assert.rejects(future.storage.load(), /版本未知/);
assert.equal(future.values.get(DESKTOP_ICON_STORAGE_KEY).schemaVersion, 2);

const unknown = makeHarness({ [DESKTOP_ICON_STORAGE_KEY]: { schemaVersion: 1, icons: { unknown: { resourceKey: `${DESKTOP_ICON_RESOURCE_PREFIX}unknown` } } } });
assert.deepEqual(await unknown.storage.load(), {});

const saved = makeHarness();
await saved.storage.save('chat', valid, metadata);
const manifest = saved.values.get(DESKTOP_ICON_STORAGE_KEY);
assert.deepEqual(Object.keys(manifest.icons), ['chat']);
assert.equal(await saved.storage.load().then(result => result.chat), valid);

const corrupted = makeHarness({
    [DESKTOP_ICON_STORAGE_KEY]: { schemaVersion: 1, icons: {
        chat: { resourceKey: `${DESKTOP_ICON_RESOURCE_PREFIX}chat`, mime: 'image/png', width: 256, height: 256, byteLength: 12 },
        directory: { resourceKey: `${DESKTOP_ICON_RESOURCE_PREFIX}directory`, mime: 'image/png', width: 256, height: 256, byteLength: 12 },
    } },
    [`${DESKTOP_ICON_RESOURCE_PREFIX}chat`]: 'not-a-data-url',
    [`${DESKTOP_ICON_RESOURCE_PREFIX}directory`]: valid,
});
assert.deepEqual(await corrupted.storage.load(), { directory: valid });

const old = makeHarness();
await old.storage.save('chat', valid, metadata);
const oldManifest = structuredClone(old.values.get(DESKTOP_ICON_STORAGE_KEY));
const failingManifest = makeHarness(Object.fromEntries(old.values));
failingManifest.values.set('__fail', true);
const originalWrite = failingManifest.storage;
const commitFailure = createDesktopIconStorage({
    windowRef: {}, logger: { warn() {} },
    idbRead: async key => ({ ok: true, value: failingManifest.values.get(key) }),
    idbWrite: async (key, value) => key === DESKTOP_ICON_STORAGE_KEY ? false : (failingManifest.values.set(key, value), true),
    idbDelete: async key => (failingManifest.values.delete(key), true),
});
await assert.rejects(commitFailure.save('chat', valid, metadata), /清单提交失败/);
assert.deepEqual(failingManifest.values.get(DESKTOP_ICON_STORAGE_KEY), oldManifest);

await old.storage.remove('chat');
assert.equal(old.values.has(DESKTOP_ICON_STORAGE_KEY), true);
assert.deepEqual(old.values.get(DESKTOP_ICON_STORAGE_KEY).icons, {});
await old.storage.replace({ directory: { dataUrl: valid, ...metadata }, settings: { dataUrl: valid, ...metadata } });
assert.deepEqual(Object.keys(old.values.get(DESKTOP_ICON_STORAGE_KEY).icons).sort(), ['directory', 'settings']);

await assert.rejects(old.storage.save('calendar', png(DESKTOP_ICON_MAX_ITEM_BYTES + 3), metadata), /单项容量/);
const tooMany = Object.fromEntries(DESKTOP_ICON_IDS.map(id => [id, { dataUrl: png(230 * 1024), ...metadata }]));
await assert.rejects(old.storage.replace(tooMany), /总容量/);

const previousWindow = globalThis.window;
const previousAlert = globalThis.alert;
try {
    globalThis.window = { __pmTheme: {}, __pmDesktopIcons: { chat: runtimeValid, community: runtimeValid } };
    const desktop = renderPhoneDesktop();
    assert.equal((desktop.match(/<img /g) || []).length, 2, '只有配置了自定义资源的桌面入口应渲染图片');
    assert.match(desktop, /data-app="chat"[\s\S]*?<img [^>]*aria-hidden="true"/);
    assert.match(desktop, /data-action="desktop-community"[\s\S]*?<img [^>]*aria-hidden="true"/);
    assert.match(desktop, /data-app="directory"[\s\S]*?<svg /, '未配置入口必须保留默认 SVG');
    const customIcon = resolveDesktopAppIcon('chat', '<svg id="fallback"></svg>');
    assert.match(customIcon, /<svg id="fallback"><\/svg>[\s\S]*<img /, '图片异常时必须保留默认 SVG 作为回退');
    assert.match(customIcon, /previousElementSibling\.hidden=true/, '图片正常解码后必须隐藏默认 SVG，防止底图透出');
    assert.match(customIcon, /previousElementSibling\.hidden=false;this\.remove\(\)/, '图片解码失败必须恢复默认 SVG');
    assert.match(customIcon, /naturalWidth!==256\|\|this\.naturalHeight!==256/, '运行时解码尺寸异常必须回退');
    globalThis.window.__pmDesktopIcons.chat = 'data:image/svg+xml;base64,PHN2Zz4=';
    assert.equal(resolveDesktopAppIcon('chat', '<svg id="fallback"></svg>'), '<svg id="fallback"></svg>', '非 PNG 运行时值必须回退默认 SVG');
    for (const broken of ['data:image/png;base64,', 'data:image/png;base64,***=', valid, png(DESKTOP_ICON_MAX_ITEM_BYTES + 3)]) {
        globalThis.window.__pmDesktopIcons.chat = broken;
        assert.equal(resolveDesktopAppIcon('chat', '<svg id="fallback"></svg>'), '<svg id="fallback"></svg>');
    }

    const alerts = [];
    globalThis.alert = message => alerts.push(String(message));
    let cropOptions = null;
    let refreshCount = 0;
    let overlayCount = 0;
    const savedIcons = [];
    const removedIcons = [];
    const replacedIcons = [];
    const windowRef = { __pmDesktopIcons: {} };
    class FakeImage {
        set src(value) {
            this._src = value;
            if (value) { this.naturalWidth = 800; this.naturalHeight = 400; queueMicrotask(() => this.onload?.()); }
        }
        get src() { return this._src; }
    }
    const settings = createDesktopIconSettings({
        openCropper: (source, options) => { cropOptions = { source, ...options }; },
        makeOverlay: () => { overlayCount += 1; },
        renderSettingsModal: value => value,
        escapeAttr: value => String(value),
        refreshDesktop: () => { refreshCount += 1; },
        ImageCtor: FakeImage,
        loadIcons: async () => windowRef.__pmDesktopIcons,
        saveIcon: async (...args) => { savedIcons.push(args); windowRef.__pmDesktopIcons[args[0]] = args[1]; },
        removeIcon: async appId => { removedIcons.push(appId); delete windowRef.__pmDesktopIcons[appId]; },
        replaceIcons: async icons => { replacedIcons.push(icons); windowRef.__pmDesktopIcons = {}; },
        windowRef,
        urlApi: { createObjectURL: () => 'blob:desktop-icon', revokeObjectURL() {} },
        confirmAction: () => true,
    });
    const input = { files: [{ type: 'image/png', size: 1024 }], value: 'chosen' };
    assert.equal(await settings.upload(input, 'chat'), true);
    assert.equal(input.value, '');
    assert.equal(cropOptions.ratio, 1); assert.equal(cropOptions.outputWidth, 256); assert.equal(cropOptions.outputHeight, 256);
    assert.equal(cropOptions.mime, 'image/png'); assert.equal(cropOptions.fit, 'cover'); assert.equal(cropOptions.preserveTransparency, true);
    await cropOptions.onConfirm(valid);
    assert.deepEqual(savedIcons[0], ['chat', valid, { width: 256, height: 256 }]);
    assert.equal(refreshCount, 1); assert.ok(overlayCount >= 1, '保存成功后必须重绘设置页');
    await settings.reset('chat');
    assert.deepEqual(removedIcons, ['chat']); assert.equal(refreshCount, 2);
    windowRef.__pmDesktopIcons = { directory: valid };
    await settings.resetAll();
    assert.deepEqual(replacedIcons, [{}]); assert.equal(refreshCount, 3);
    assert.deepEqual(alerts, []);
} finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousAlert === undefined) delete globalThis.alert; else globalThis.alert = previousAlert;
}

const cleanup = await import('../src/storage.js');
assert(cleanup.PLUGIN_IDB_STATIC_KEYS.includes(DESKTOP_ICON_STORAGE_KEY));
assert(cleanup.PLUGIN_IDB_DYNAMIC_PREFIXES.includes(DESKTOP_ICON_RESOURCE_PREFIX));
console.log('desktop icon storage checks passed');
