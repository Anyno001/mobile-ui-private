import {
    APPEARANCE_PACK_MAX_BYTES, createAppearancePack, parseAppearancePack,
} from './appearance-pack.js';
import { DESKTOP_ICON_SIZE } from './desktop-icon-storage.js';
import { loadDesktopIcons, replaceDesktopIcons } from './desktop-icon-storage.js';
import { loadLocalBackground, saveBgGlobal, saveBgLocal, saveDesktopBg } from './storage-background.js';
import { saveTheme } from './storage.js';

const clone = value => JSON.parse(JSON.stringify(value));

export async function validateAppearancePackImages(pack, { ImageCtor = globalThis.Image } = {}) {
    if (typeof ImageCtor !== 'function') throw new Error('当前环境不支持图片解码');
    const entries = [
        ...Object.entries(pack.appearance.backgrounds).filter(([, value]) => !!value).map(([id, value]) => ({ id: `背景 ${id}`, value, icon: false })),
        ...Object.entries(pack.appearance.icons).map(([id, value]) => ({ id: `图标 ${id}`, value, icon: true })),
    ];
    for (const entry of entries) {
        await new Promise((resolve, reject) => {
            const image = new ImageCtor();
            image.onload = () => {
                const width = Number(image.naturalWidth || image.width);
                const height = Number(image.naturalHeight || image.height);
                image.src = '';
                if (!width || !height) return reject(new Error(`${entry.id} 解码后尺寸无效`));
                if (entry.icon && (width !== DESKTOP_ICON_SIZE || height !== DESKTOP_ICON_SIZE)) {
                    return reject(new Error(`${entry.id} 必须为 ${DESKTOP_ICON_SIZE}x${DESKTOP_ICON_SIZE}`));
                }
                if (!entry.icon && (width > 8192 || height > 8192)) return reject(new Error(`${entry.id} 解码尺寸超过 8192px`));
                resolve();
            };
            image.onerror = () => { image.src = ''; reject(new Error(`${entry.id} 无法解码`)); };
            image.src = entry.value;
        });
    }
    return true;
}

export function createAppearancePackController({
    backgroundSettings, getStorageId, getCurrentPersona, renderPage, renderPreview, renderSettingsModal, makeOverlay,
    documentRef = globalThis.document, windowRef = globalThis.window,
    urlApi = globalThis.URL, BlobCtor = globalThis.Blob, alertAction = globalThis.alert,
    loadIcons = loadDesktopIcons, loadContactBackground = loadLocalBackground,
    parsePack = parseAppearancePack, replaceIcons = replaceDesktopIcons,
    saveThemeAction = saveTheme, saveDesktopAction = saveDesktopBg, saveGlobalAction = saveBgGlobal, saveLocalAction = saveBgLocal,
    applyTheme = () => {}, applyBackground = async () => {}, refreshDesktop = () => {},
    syncAmbientStatus = () => windowRef.__pmSyncAmbientStatus?.(),
    validateImages = validateAppearancePackImages,
} = {}) {
    let pendingImport = null;
    let mutationQueue = Promise.resolve();
    const enqueueMutation = operation => {
        const result = mutationQueue.then(operation, operation);
        mutationQueue = result.catch(() => undefined);
        return result;
    };
    const currentContactKey = () => {
        const storageId = String(getStorageId?.() || '').trim();
        const persona = String(getCurrentPersona?.() || '').trim();
        return storageId && persona ? `${storageId}_${persona}` : '';
    };

    const showPage = async () => {
        await backgroundSettings.load();
        makeOverlay(renderSettingsModal({ title: '一键美化', content: renderPage() }));
    };

    const showPreview = preview => makeOverlay(renderSettingsModal({ title: '导入美化包', content: renderPreview(preview), backAction: "window.__pmShowConfig('appearance-pack')" }));

    const readMeta = () => ({
        name: documentRef.getElementById('pm-appearance-name')?.value || '',
        author: documentRef.getElementById('pm-appearance-author')?.value || '',
        description: documentRef.getElementById('pm-appearance-description')?.value || '',
    });

    const exportPack = async () => {
        try {
            await backgroundSettings.load();
            const localKey = currentContactKey();
            const currentContact = localKey ? await loadContactBackground(localKey) : '';
            const { pack, serialized } = createAppearancePack({
                meta: readMeta(),
                theme: windowRef.__pmTheme || {},
                backgrounds: {
                    desktop: windowRef.__pmDesktopBg || '',
                    global: windowRef.__pmBgGlobal || '',
                    currentContact,
                },
                icons: await loadIcons(),
            });
            const url = urlApi.createObjectURL(new BlobCtor([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
            try {
                const link = documentRef.createElement('a');
                link.href = url;
                link.download = `TianyinAppearance_${Date.now()}.json`;
                link.click();
            } finally { urlApi.revokeObjectURL(url); }
            alertAction(`美化包已导出，共 ${new TextEncoder().encode(serialized).byteLength} 字节。`);
            return true;
        } catch (error) {
            alertAction(`美化包导出失败，未生成文件。\n${error.message}`);
            return false;
        }
    };

    const previewFor = ({ pack, totalBytes }, targetKey) => ({
        meta: pack.meta,
        schemaVersion: pack.schemaVersion,
        totalBytes,
        theme: pack.appearance.theme,
        backgrounds: pack.appearance.backgrounds,
        iconIds: Object.keys(pack.appearance.icons),
        currentContactWillApply: !!targetKey,
    });

    const importPack = async input => {
        const file = input?.files?.[0];
        if (!file) return false;
        try {
            const fileName = String(file.name || '');
            const fileType = String(file.type || '').toLowerCase();
            if (fileType && fileType !== 'application/json' && fileType !== 'text/json') throw new Error('只支持 JSON 美化包');
            if (fileName && !fileName.toLowerCase().endsWith('.json')) throw new Error('美化包文件扩展名必须是 .json');
            if (Number(file.size) > APPEARANCE_PACK_MAX_BYTES) throw new Error('美化包总容量超过 12MiB');
            const text = typeof file.text === 'function' ? await file.text() : String(file.content || '');
            const parsed = parsePack(text);
            await validateImages(parsed.pack);
            const targetKey = currentContactKey();
            pendingImport = { parsed, targetKey };
            showPreview(previewFor(parsed, targetKey));
            return true;
        } catch (error) {
            pendingImport = null;
            alertAction(`美化包读取失败，未修改任何设置。\n${error.message}`);
            return false;
        } finally { input.value = ''; }
    };

    const captureSnapshot = async targetKey => {
        await backgroundSettings.load();
        const local = clone(windowRef.__pmBgLocal || {});
        if (targetKey) {
            const actual = await loadContactBackground(targetKey);
            if (actual) local[targetKey] = actual;
            else delete local[targetKey];
        }
        return {
            theme: clone(windowRef.__pmTheme || {}),
            desktop: windowRef.__pmDesktopBg || '',
            global: windowRef.__pmBgGlobal || '',
            local,
            icons: await loadIcons(),
        };
    };

    const persistState = async (state, { beforeLocal } = {}) => {
        windowRef.__pmTheme = clone(state.theme);
        windowRef.__pmDesktopBg = state.desktop;
        windowRef.__pmBgGlobal = state.global;
        if (!saveThemeAction()) throw new Error('主题保存失败：浏览器存储不可用');
        await saveDesktopAction();
        await saveGlobalAction();
        const local = beforeLocal ? beforeLocal() : state.local;
        windowRef.__pmBgLocal = clone(local);
        windowRef.__pmBgLocal = await saveLocalAction({ data: windowRef.__pmBgLocal });
        await replaceIcons(state.icons);
    };

    const refreshAppearance = async state => {
        applyTheme();
        await applyBackground();
        refreshDesktop();
        syncAmbientStatus();
    };

    const confirmImport = () => enqueueMutation(async () => {
        const pending = pendingImport;
        if (!pending) return false;
        pendingImport = null;
        const { pack } = pending.parsed;
        let snapshot = null;
        try {
            snapshot = await captureSnapshot(pending.targetKey);
            const next = {
                theme: { ...snapshot.theme, ...pack.appearance.theme },
                desktop: pack.appearance.backgrounds.desktop,
                global: pack.appearance.backgrounds.global,
                local: clone(snapshot.local),
                icons: pack.appearance.icons,
            };
            if (pending.targetKey) {
                const localValue = pack.appearance.backgrounds.currentContact;
                if (localValue) next.local[pending.targetKey] = localValue;
                else delete next.local[pending.targetKey];
            }
            let contactApplied = false;
            await persistState(next, { beforeLocal: () => {
                contactApplied = !!pending.targetKey && currentContactKey() === pending.targetKey;
                return contactApplied ? next.local : snapshot.local;
            } });
            await refreshAppearance(next);
            alertAction(contactApplied || !pack.appearance.backgrounds.currentContact
                ? '美化包导入成功。'
                : '美化包导入成功；当前联系人已变化，联系人背景已跳过。');
            await showPage();
            return true;
        } catch (error) {
            if (!snapshot) {
                alertAction(`美化包导入失败，未修改任何设置。\n${error.message}`);
                return false;
            }
            try {
                await persistState(snapshot);
                await refreshAppearance(snapshot);
                alertAction(`美化包导入失败，原外观已恢复。\n${error.message}`);
            } catch (rollbackError) {
                alertAction(`美化包导入失败，原外观恢复也失败。请勿刷新，并立即导出完整数据备份。\n${error.message}\n${rollbackError.message}`);
            }
            return false;
        }
    });

    const cancelImport = async () => { pendingImport = null; await showPage(); return true; };

    return Object.freeze({ showPage, exportPack, importPack, confirmImport, cancelImport, currentContactKey, previewFor });
}
