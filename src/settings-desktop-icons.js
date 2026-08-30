import { DESKTOP_ICON_IDS, DESKTOP_ICON_MAX_ITEM_BYTES, DESKTOP_ICON_SIZE, loadDesktopIcons, removeDesktopIcon, replaceDesktopIcons, saveDesktopIcon } from './desktop-icon-storage.js';
import { CALENDAR_ICON_SVG, CHAT_ICON_SVG, COMMUNITY_ICON_SVG, CONTACTS_ICON_SVG, SETTINGS_ICON_SVG, SPARKLES_ICON_SVG, TREND_ICON_SVG } from './icons.js';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_DIMENSION = 4096;
const LABELS = Object.freeze({ chat: '会话', directory: '联系人', settings: '设置', calendar: '日历', todayTrend: '今日风向', storyOracle: '剧情助手', community: '发布一条' });
const FALLBACKS = Object.freeze({ chat: CHAT_ICON_SVG, directory: CONTACTS_ICON_SVG, settings: SETTINGS_ICON_SVG, calendar: CALENDAR_ICON_SVG, todayTrend: TREND_ICON_SVG, storyOracle: SPARKLES_ICON_SVG, community: COMMUNITY_ICON_SVG });
const ACCEPTED_TYPES = new Set(['image/png', 'image/webp', 'image/jpeg']);

function inspectImage(objectUrl, ImageCtor = globalThis.Image) {
    return new Promise((resolve, reject) => {
        const image = new ImageCtor();
        image.onload = () => {
            const width = image.naturalWidth, height = image.naturalHeight;
            image.src = '';
            if (!width || !height || width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) reject(new Error(`图片尺寸必须在 1–${MAX_SOURCE_DIMENSION}px 之间`));
            else resolve({ width, height });
        };
        image.onerror = () => { image.src = ''; reject(new Error('图片无法解码')); };
        image.src = objectUrl;
    });
}

export function createDesktopIconSettings({
    openCropper, makeOverlay, renderSettingsModal, escapeAttr, refreshDesktop,
    ImageCtor = globalThis.Image,
    loadIcons = loadDesktopIcons,
    saveIcon = saveDesktopIcon,
    removeIcon = removeDesktopIcon,
    replaceIcons = replaceDesktopIcons,
    windowRef = globalThis.window,
    urlApi = globalThis.URL,
    confirmAction = globalThis.confirm,
}) {
    const refresh = () => { if (typeof refreshDesktop === 'function') refreshDesktop(); };
    const rows = () => DESKTOP_ICON_IDS.map(appId => {
        const custom = windowRef?.__pmDesktopIcons?.[appId];
        const preview = custom ? `<img src="${escapeAttr(custom)}" alt="">` : FALLBACKS[appId];
        return `<div class="pm-desktop-icon-row"><span class="pm-desktop-icon-preview${custom ? ' is-custom' : ''}">${preview}</span><span><b>${LABELS[appId]}</b><small>${custom ? '自定义图标' : '默认图标'}</small></span><span class="pm-desktop-icon-actions"><input id="pm-desktop-icon-file-${appId}" type="file" accept="image/png,image/webp,image/jpeg" onchange="window.__pmUploadDesktopIcon(this,'${appId}')" hidden><button type="button" class="pm-bg-btn" aria-label="选择${LABELS[appId]}图标" onclick="document.getElementById('pm-desktop-icon-file-${appId}').click()">选择图片</button>${custom ? `<button type="button" class="pm-bg-btn pm-bg-del" onclick="window.__pmResetDesktopIcon('${appId}')">重置</button>` : ''}</span></div>`;
    }).join('');
    const showPage = async () => {
        try { await loadIcons(); }
        catch (error) { if (windowRef) windowRef.__pmDesktopIcons = {}; console.warn('[phone-mode] 桌面图标读取失败', error); }
        makeOverlay(renderSettingsModal({ title: '桌面图标', content: `<div class="pm-settings-page"><div class="pm-settings-section"><div class="pm-cfg-tip">支持 PNG、WebP 或 JPEG，裁剪后统一保存为 256×256 PNG，并覆盖整个图标区域。</div><div class="pm-desktop-icon-list">${rows()}</div></div><div class="pm-settings-tail"></div></div>`, footer: '<div class="pm-modal-add"><button type="button" class="pm-action-button is-secondary is-full" onclick="window.__pmResetAllDesktopIcons()">全部恢复默认</button></div>', backAction: "window.__pmShowConfig('look')", backLabel: '返回主题设置' }));
    };

    let mutation = Promise.resolve();
    const runMutation = operation => {
        const pending = mutation.catch(() => {}).then(operation);
        mutation = pending;
        return pending;
    };
    const handleFailure = async (label, error) => {
        alert(error?.rollbackError
            ? `${label}失败，原图标回滚也失败。请勿刷新，并立即导出备份。\n${error.message}`
            : `${label}失败，原图标已保留。\n${error.message}`);
        await showPage();
        return false;
    };
    const upload = async (input, appId) => {
        const file = input?.files?.[0];
        if (!file) return false;
        input.value = '';
        if (!DESKTOP_ICON_IDS.includes(appId)) { alert('桌面图标标识无效。'); return false; }
        if (!ACCEPTED_TYPES.has(file.type)) { alert('仅支持 PNG、WebP 或 JPEG 图片。'); return false; }
        if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_SOURCE_BYTES) { alert('原图片大小必须在 5MB 以内。'); return false; }
        const objectUrl = urlApi.createObjectURL(file);
        try {
            await inspectImage(objectUrl, ImageCtor);
            openCropper(objectUrl, {
                objectUrl,
                title: `设置${LABELS[appId]}图标`,
                tip: '拖动图片调整位置，缩放后会覆盖整个图标区域',
                confirmText: '使用图标',
                ratio: 1,
                outputWidth: DESKTOP_ICON_SIZE,
                outputHeight: DESKTOP_ICON_SIZE,
                mime: 'image/png',
                fit: 'cover',
                preserveTransparency: true,
                quality: { maxLength: Math.ceil(DESKTOP_ICON_MAX_ITEM_BYTES * 4 / 3) + 64 },
                onCancel: showPage,
                onConfirm: dataUrl => runMutation(async () => {
                    try {
                        await saveIcon(appId, dataUrl, { width: DESKTOP_ICON_SIZE, height: DESKTOP_ICON_SIZE });
                        refresh();
                        await showPage();
                        return true;
                    } catch (error) { return handleFailure('图标保存', error); }
                }),
            });
            return true;
        } catch (error) {
            urlApi.revokeObjectURL(objectUrl);
            alert(`图片读取失败：${error.message}`);
            return false;
        }
    };
    const reset = appId => runMutation(async () => {
        try { await removeIcon(appId); refresh(); await showPage(); return true; }
        catch (error) { return handleFailure('图标重置', error); }
    });
    const resetAll = () => runMutation(async () => {
        if (Object.keys(windowRef?.__pmDesktopIcons || {}).length && !confirmAction('确定恢复全部默认图标吗？')) return false;
        try { await replaceIcons({}); refresh(); await showPage(); return true; }
        catch (error) { return handleFailure('全部图标重置', error); }
    });
    return Object.freeze({ showPage, upload, reset, resetAll });
}
