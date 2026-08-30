import assert from 'node:assert/strict';
import {
    APPEARANCE_PACK_FORMAT, APPEARANCE_PACK_SCHEMA_VERSION,
    createAppearancePack, parseAppearancePack,
} from '../src/appearance-pack.js';
import { createAppearancePackController } from '../src/settings-appearance-pack.js';

const png = 'data:image/png;base64,AAAA';
const fixedNow = () => '2026-08-29T12:00:00.000Z';
const theme = {
    preset: 'custom', customAccent: '#123456', customRight: '#234567', customLeft: '#345678',
    borderColor: '#456789', darkMode: 'dark', ambientStatusEnabled: true,
    customTitle: '作者主题', layout: 'standard', phoneScale: 1.2,
};
const created = createAppearancePack({
    meta: { name: '示例', author: '作者', description: '只含外观' },
    theme,
    backgrounds: { desktop: png, global: '', currentContact: png },
    icons: { chat: png, community: png }, now: fixedNow,
});
assert.equal(created.pack.format, APPEARANCE_PACK_FORMAT);
assert.equal(created.pack.schemaVersion, APPEARANCE_PACK_SCHEMA_VERSION);
assert.equal(created.pack.meta.createdAt, fixedNow());
assert.equal(created.pack.appearance.theme.customAccent, '#123456');
assert.deepEqual(parseAppearancePack(created.serialized).pack, created.pack, '美化包必须可稳定往返');
assert.equal(created.totalBytes, new TextEncoder().encode(created.serialized).byteLength);

for (const forbidden of ['histories', 'config', 'profiles', 'bgLocal', 'apiKey', 'calendarStore', 'userGeneration']) {
    assert.equal(created.serialized.includes(`\"${forbidden}\"`), false, `美化包不得包含 ${forbidden}`);
}
const parsedObject = JSON.parse(created.serialized);
assert.throws(() => parseAppearancePack({ ...parsedObject, histories: {} }), /根节点 包含未知字段/);
assert.throws(() => parseAppearancePack({ ...parsedObject, schemaVersion: 2 }), /高于当前支持版本/);
assert.throws(() => parseAppearancePack({ ...parsedObject, meta: { ...parsedObject.meta, apiKey: 'secret' } }), /meta 包含未知字段/);
assert.throws(() => parseAppearancePack({ ...parsedObject, appearance: { ...parsedObject.appearance, backgrounds: { ...parsedObject.appearance.backgrounds, desktop: 'https:\/\/example.test\/bg.png' } } }), /自包含/);
assert.throws(() => parseAppearancePack({ ...parsedObject, appearance: { ...parsedObject.appearance, icons: { unknown: png } } }), /未知图标/);
assert.throws(() => parseAppearancePack({ ...parsedObject, appearance: { ...parsedObject.appearance, theme: { ...parsedObject.appearance.theme, qrLabel: '泄漏' } } }), /主题 包含未知字段/);
assert.throws(() => parseAppearancePack({ ...parsedObject, appearance: { ...parsedObject.appearance, theme: { ...parsedObject.appearance.theme, phoneScale: 2 } } }), /phoneScale/);
assert.throws(() => parseAppearancePack({ format: APPEARANCE_PACK_FORMAT, schemaVersion: 1 }), /根节点 缺少字段/);
assert.throws(() => parseAppearancePack('{broken'), /JSON 无法解析/);

const fields = new Map([
    ['pm-appearance-name', { value: '控制器导出' }],
    ['pm-appearance-author', { value: '测试作者' }],
    ['pm-appearance-description', { value: '控制器行为测试' }],
]);
const links = [];
const alerts = [];
const urls = [];
let backgroundLoads = 0;
const windowRef = {
    __pmTheme: theme,
    __pmDesktopBg: png,
    __pmBgGlobal: '',
};
const documentRef = {
    getElementById: id => fields.get(id) || null,
    createElement: tag => {
        assert.equal(tag, 'a');
        const link = { href: '', download: '', clickCount: 0, click() { this.clickCount += 1; } };
        links.push(link);
        return link;
    },
};
const controller = createAppearancePackController({
    backgroundSettings: { async load() { backgroundLoads += 1; } },
    getStorageId: () => 'story', getCurrentPersona: () => 'Alice',
    renderPage: () => '<div>appearance</div>',
    renderSettingsModal: value => value.content,
    makeOverlay() {}, documentRef, windowRef,
    loadIcons: async () => ({ chat: png }),
    loadContactBackground: async key => { assert.equal(key, 'story_Alice'); return png; },
    urlApi: {
        createObjectURL(blob) { assert(blob instanceof Blob); urls.push(['create', 'blob:appearance']); return 'blob:appearance'; },
        revokeObjectURL(url) { urls.push(['revoke', url]); },
    },
    BlobCtor: Blob,
    alertAction: message => alerts.push(String(message)),
});
assert.equal(controller.currentContactKey(), 'story_Alice');
assert.equal(await controller.exportPack(), true);
assert.equal(backgroundLoads, 1);
assert.equal(links.length, 1); assert.equal(links[0].clickCount, 1);
assert.match(links[0].download, /^TianyinAppearance_\d+\.json$/);
assert.deepEqual(urls, [['create', 'blob:appearance'], ['revoke', 'blob:appearance']]);
assert.match(alerts[0], /美化包已导出/);

windowRef.__pmDesktopBg = 'https://example.test/remote.png';
assert.equal(await controller.exportPack(), false, '远程背景不得生成残缺美化包');
assert.equal(links.length, 1, '失败时不得创建下载链接');
assert.equal(urls.length, 2, '失败时不得创建对象 URL');
assert.match(alerts.at(-1), /导出失败，未生成文件/);


const makeImportHarness = ({ failIconWrite = false, switchContactBeforeLocal = false, rejectImages = false,
    importedAmbientEnabled = true, ambientSyncResult = true } = {}) => {
    const oldTheme = { ...theme, customTitle: '旧主题' };
    const oldState = {
        theme: structuredClone(oldTheme), desktop: png, global: '',
        local: { story_Alice: png }, icons: { chat: png },
    };
    const importedBg = 'data:image/png;base64,AAAB';
    const imported = createAppearancePack({
        meta: { name: '导入包', author: '作者', description: '事务测试' },
        theme: { ...theme, customTitle: '新主题', ambientStatusEnabled: importedAmbientEnabled },
        backgrounds: { desktop: importedBg, global: importedBg, currentContact: importedBg },
        icons: { community: png }, now: fixedNow,
    });
    const runtimeWindow = {
        __pmTheme: structuredClone(oldState.theme), __pmDesktopBg: oldState.desktop,
        __pmBgGlobal: oldState.global, __pmBgLocal: structuredClone(oldState.local),
    };
    let persona = 'Alice';
    let iconState = structuredClone(oldState.icons);
    let writes = 0;
    let themeWrites = 0;
    let iconAttempts = 0;
    const previews = [];
    const notes = [];
    const controller = createAppearancePackController({
        backgroundSettings: { async load() {} },
        getStorageId: () => 'story', getCurrentPersona: () => persona,
        renderPage: () => '<div>page</div>', renderPreview: value => { previews.push(value); return '<div>preview</div>'; },
        renderSettingsModal: value => value.content, makeOverlay() {},
        documentRef: { getElementById: () => null, createElement: () => ({ click() {} }) },
        windowRef: runtimeWindow, alertAction: message => notes.push(String(message)),
        loadIcons: async () => structuredClone(iconState),
        loadContactBackground: async key => runtimeWindow.__pmBgLocal[key] || '',
        validateImages: async () => { if (rejectImages) throw new Error('图片损坏'); },
        saveThemeAction: () => { writes += 1; themeWrites += 1; return true; },
        saveDesktopAction: async () => { writes += 1; },
        saveGlobalAction: async () => { writes += 1; },
        saveLocalAction: async ({ data }) => {
            writes += 1;
            if (switchContactBeforeLocal) persona = 'Bob';
            return structuredClone(data);
        },
        replaceIcons: async icons => {
            writes += 1; iconAttempts += 1;
            if (failIconWrite && iconAttempts === 1) throw new Error('图标写入失败');
            iconState = structuredClone(icons);
        },
        applyTheme() {}, async applyBackground() {}, refreshDesktop() {}, syncAmbientStatus: () => ambientSyncResult,
    });
    const input = { files: [{ name: 'appearance.json', type: 'application/json', size: imported.totalBytes, text: async () => imported.serialized }], value: 'chosen' };
    return { controller, input, previews, notes, runtimeWindow, oldState, importedBg,
        getWrites: () => writes, getThemeWrites: () => themeWrites, getIcons: () => iconState, setPersona: value => { persona = value; } };
};

const successImport = makeImportHarness();
assert.equal(await successImport.controller.importPack(successImport.input), true);
assert.equal(successImport.input.value, '');
assert.equal(successImport.getWrites(), 0, '解析与预览阶段必须零写入');
assert.equal(successImport.previews.length, 1);
assert.equal(successImport.previews[0].currentContactWillApply, true);
assert.equal(await successImport.controller.confirmImport(), true);
assert.equal(successImport.runtimeWindow.__pmTheme.customTitle, '新主题');
assert.equal(successImport.runtimeWindow.__pmDesktopBg, successImport.importedBg);
assert.equal(successImport.runtimeWindow.__pmBgLocal.story_Alice, successImport.importedBg);
assert.deepEqual(successImport.getIcons(), { community: png });
assert.equal(successImport.getThemeWrites(), 1, '成功导入路径主题必须只持久化一次');

const ambientOffImport = makeImportHarness({ importedAmbientEnabled: false, ambientSyncResult: false });
assert.equal(await ambientOffImport.controller.importPack(ambientOffImport.input), true);
assert.equal(await ambientOffImport.controller.confirmImport(), true, '关闭本地状态栏是合法状态，不得触发回滚');
assert.equal(ambientOffImport.runtimeWindow.__pmTheme.ambientStatusEnabled, false);
assert.equal(ambientOffImport.getThemeWrites(), 1, '关闭状态栏的成功导入不得重复保存主题');

const switchedImport = makeImportHarness();
assert.equal(await switchedImport.controller.importPack(switchedImport.input), true);
switchedImport.setPersona('Bob');
assert.equal(await switchedImport.controller.confirmImport(), true);
assert.equal(switchedImport.runtimeWindow.__pmBgLocal.story_Alice, png, '联系人切换后不得改写锁定联系人的背景');
assert.match(switchedImport.notes.at(-1), /联系人背景已跳过/);

const decodeFailure = makeImportHarness({ rejectImages: true });
assert.equal(await decodeFailure.controller.importPack(decodeFailure.input), false);
assert.equal(decodeFailure.getWrites(), 0, '图片预校验失败必须零写入');
assert.match(decodeFailure.notes.at(-1), /未修改任何设置/);

const rollbackImport = makeImportHarness({ failIconWrite: true });
assert.equal(await rollbackImport.controller.importPack(rollbackImport.input), true);
assert.equal(await rollbackImport.controller.confirmImport(), false);
assert.deepEqual(rollbackImport.runtimeWindow.__pmTheme, rollbackImport.oldState.theme);
assert.equal(rollbackImport.runtimeWindow.__pmDesktopBg, rollbackImport.oldState.desktop);
assert.equal(rollbackImport.runtimeWindow.__pmBgGlobal, rollbackImport.oldState.global);
assert.deepEqual(rollbackImport.runtimeWindow.__pmBgLocal, rollbackImport.oldState.local);
assert.deepEqual(rollbackImport.getIcons(), rollbackImport.oldState.icons);
assert.match(rollbackImport.notes.at(-1), /原外观已恢复/);

console.log('appearance pack format checks passed');
