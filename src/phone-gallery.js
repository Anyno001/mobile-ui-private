// 相册 App：生成过的图片、角色形象（DNA）和生图设置。
import { keepScroll } from './scroll-keeper.js';
import { DNA_FRAMES } from './phone-image-describe.js';
import { USER_DNA_KEY } from './phone-image-dna.js';
import { imageUrl } from './phone-image-store.js';
import { GLOBAL_PROFILE_ID, loadImageSettings, saveImageSettings } from './phone-image-settings.js';
import { openProfileEditor, renderImageSettingsPage } from './phone-image-settings-view.js';
import { BACK_ICON_SVG, CLOSE_ICON_SVG, SETTINGS_ICON_SVG, USER_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

const PAGE_SIZE = 60;
const GALLERY_SCROLLERS = ['.pm-gallery-scroll'];
const FILTERS = Object.freeze({ all: '全部', chat: '聊天', community: '社区', video: '视频', favorite: '收藏' });

export function installPhoneGallery(state, deps) {
    const { getStorageId, getUserPersona, makeOverlay, closeOverlay } = deps;
    let page = null;
    let boundWindow = null;
    let lifecycle = null;
    let unsubscribe = null;
    let view = 'grid';
    let filter = 'all';
    let scopeAll = false;
    let limit = PAGE_SIZE;
    let renderSerial = 0;
    let notice = '';
    const images = () => deps.phoneImages;
    const storageId = () => state.activeStorageId || getStorageId?.() || '';
    const userName = () => String(getUserPersona?.()?.name || '').trim() || '我';
    const userLabel = () => userName() === '我' ? '我' : `${userName()}（我）`;

    function header(title, { back = 'desktop', trailing = '' } = {}) {
        return `<header class="pm-gallery-header"><button type="button" class="pm-gallery-icon-button" data-gallery-action="${back}" aria-label="返回" title="返回">${BACK_ICON_SVG}</button><h2>${escapeHtml(title)}</h2>${trailing || '<span></span>'}</header>`;
    }

    async function visibleRecords() {
        const id = storageId();
        return (await images().store.list()).filter(record => (scopeAll || record.source.storageId === id)
            && (filter === 'all' || (filter === 'favorite' ? record.favorite : record.source.type === filter)));
    }

    // 同一页面（同视图、同筛选）重绘时保持滚动位置：「加载更多」、收藏、切换范围后不回到顶部。
    let renderedKey = null;
    function writePage(html) {
        const key = `${view}|${filter}|${scopeAll}`;
        keepScroll(page, GALLERY_SCROLLERS, key === renderedKey, () => { page.innerHTML = html; });
        renderedKey = key;
    }

    async function renderGrid(serial) {
        const records = await visibleRecords();
        if (serial !== renderSerial) return;
        const tabs = Object.entries(FILTERS).map(([key, label]) => `<button type="button" role="tab" class="pm-gallery-tab" data-gallery-action="filter" data-filter="${key}" aria-selected="${key === filter}">${label}</button>`).join('');
        const tiles = records.slice(0, limit).map(record => `<button type="button" class="pm-gallery-tile" data-gallery-action="view" data-image-id="${escapeAttr(record.id)}" aria-label="${escapeAttr(record.description || '图片')}"><img data-thumb-id="${escapeAttr(record.id)}" alt="" decoding="async"${record.width && record.height ? ` width="${record.width}" height="${record.height}"` : ''}>${record.favorite ? '<span class="pm-gallery-tile-mark" aria-label="已收藏"></span>' : ''}</button>`).join('');
        const empty = `<p class="pm-gallery-empty">${filter === 'favorite' ? '暂无收藏的图片。' : '暂无图片。可在聊天或社区的图片上点击「生成图片」，或使用快捷工具中的「拍一张」。'}</p>`;
        writePage(`<div class="pm-gallery-shell">
  ${header('相册', { trailing: `<button type="button" class="pm-gallery-icon-button" data-gallery-action="settings" aria-label="生图设置" title="生图设置">${SETTINGS_ICON_SVG}</button>` })}
  <div class="pm-gallery-toolbar"><div class="pm-gallery-tabs" role="tablist" aria-label="筛选">${tabs}</div><button type="button" class="pm-gallery-scope" data-gallery-action="scope" aria-pressed="${scopeAll}">${scopeAll ? '所有聊天' : '当前聊天'}</button></div>
  <button type="button" class="pm-gallery-people-entry" data-gallery-action="people">${USER_ICON_SVG}<span>角色形象</span><small>保持长相一致</small></button>
  ${notice ? `<p class="pm-gallery-notice" role="status">${escapeHtml(notice)}</p>` : ''}
  <div class="pm-gallery-scroll">${records.length ? `<div class="pm-gallery-grid">${tiles}</div>` : empty}
  ${records.length > limit ? '<button type="button" class="pm-action-button is-full" data-gallery-action="more">加载更多</button>' : ''}</div>
</div>`);
        loadThumbnails(records.slice(0, limit), serial);
    }

    async function loadThumbnails(records, serial) {
        for (const record of records) {
            if (serial !== renderSerial) return;
            const node = page?.querySelector(`img[data-thumb-id="${CSS.escape(record.id)}"]`);
            if (!node) continue;
            const thumb = await images().store.thumbnail(record);
            if (serial !== renderSerial || !node.isConnected) return;
            node.src = thumb || imageUrl(record.path);
        }
    }

    function peopleNames() {
        const names = state.isGroupChat ? state.groupMembers.slice() : [state.currentPersona].filter(Boolean);
        return [...new Set(names.map(name => String(name || '').trim()).filter(Boolean))];
    }

    async function renderPeople(serial) {
        const dna = images().dna;
        const scopeKey = dna.scopeKey();
        const saved = await dna.list(scopeKey);
        const names = [...new Set([...peopleNames(), ...saved.map(item => item.name).filter(name => name !== USER_DNA_KEY)])];
        const rows = [];
        for (const name of [USER_DNA_KEY, ...names]) {
            const isUser = name === USER_DNA_KEY;
            const resolved = await dna.resolve(isUser ? userName() : name, { isUser, allowWrite: false });
            const label = isUser ? userLabel() : name;
            const source = resolved.dna ? '已保存' : '尚未建立';
            rows.push(`<li class="pm-gallery-person"><div class="pm-gallery-person-text"><b>${escapeHtml(label)}</b><small>${source}</small></div><button type="button" class="pm-gallery-chip" data-gallery-action="edit-dna" data-name="${escapeAttr(name)}">${resolved.dna ? '查看' : '建立'}</button></li>`);
        }
        if (serial !== renderSerial) return;
        writePage(`<div class="pm-gallery-shell">
  ${header('角色形象', { back: 'grid' })}
  <div class="pm-gallery-scroll">
    <p class="pm-gallery-intro">出图时将以下外貌交给数据库生图，使同一角色长相一致。尚未建立的角色在首次出图时由手机API生成，也可在此手动填写。</p>
    ${notice ? `<p class="pm-gallery-notice" role="status">${escapeHtml(notice)}</p>` : ''}
    <ul class="pm-gallery-people">${rows.join('')}</ul>
  </div>
</div>`);
    }

    function renderSettings() {
        writePage(renderImageSettingsPage(header));
    }

    function render() {
        if (!page) return;
        renderSerial += 1;
        const serial = renderSerial;
        if (view === 'people') renderPeople(serial).catch(error => { notice = error?.message || String(error); });
        else if (view === 'settings') renderSettings();
        else renderGrid(serial).catch(error => { notice = error?.message || String(error); });
    }

    function openDnaEditor(name) {
        const dna = images().dna;
        const scopeKey = dna.scopeKey();
        const isUser = name === USER_DNA_KEY;
        const label = isUser ? userLabel() : name;
        dna.list(scopeKey).then(list => {
            const record = list.find(item => item.name === name);
            const views = record?.dna?.views || {};
            const fields = Object.entries(DNA_FRAMES).map(([key, frame]) => `<label class="pm-gallery-field"><span>${frame}外貌</span><textarea data-dna-field="${key}" rows="3" spellcheck="false">${escapeHtml(views[key]?.subject || '')}</textarea></label>`).join('');
            const overlay = makeOverlay(`<div class="pm-modal pm-modal-wide pm-gallery-dna" role="dialog" aria-modal="true" aria-labelledby="pm-gallery-dna-title">
  <div class="pm-modal-header"><span></span><b id="pm-gallery-dna-title">${escapeHtml(label)}</b><button type="button" class="pm-modal-close" data-dna-action="close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll pm-gallery-dna-body">
    <p class="pm-gallery-intro">英文标签，以逗号分隔；仅填写长相与体型，不含服装。</p>
    ${fields}
    <label class="pm-gallery-field"><span>排除项</span><textarea data-dna-field="negative" rows="2" spellcheck="false">${escapeHtml(views.full_body?.negative || views.half_body?.negative || '')}</textarea></label>
    <label class="pm-gallery-field"><span>性格</span><textarea data-dna-field="personality" rows="2">${escapeHtml(record?.dna?.personality || '')}</textarea></label>
    <p class="pm-gallery-dna-status" role="status" aria-live="polite" hidden></p>
  </div>
  <div class="pm-gallery-dna-actions">
    <button type="button" class="pm-action-button is-flex-1" data-dna-action="rewrite">AI重写</button>
    ${record ? '<button type="button" class="pm-action-button is-flex-1" data-dna-action="clear">清空</button>' : ''}
    <button type="button" class="pm-action-button is-accent is-flex-1" data-dna-action="save">保存</button>
  </div>
</div>`);
            const status = overlay.querySelector('.pm-gallery-dna-status');
            const show = message => { status.hidden = !message; status.textContent = message; };
            const value = key => overlay.querySelector(`[data-dna-field="${key}"]`)?.value || '';
            let confirmClear = false;
            overlay.querySelector('textarea')?.focus();
            overlay.addEventListener('click', async event => {
                const button = event.target.closest('[data-dna-action]');
                if (!button || button.disabled) return;
                const action = button.dataset.dnaAction;
                if (action === 'close') return closeOverlay('close');
                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    if (action === 'save') {
                        const negative = value('negative').trim();
                        const views = Object.fromEntries(Object.keys(DNA_FRAMES).map(key => [key, { subject: value(key), ...(negative && { negative }) }]));
                        await dna.saveManual(scopeKey, name, { views, personality: value('personality') });
                        closeOverlay('close');
                        render();
                        return;
                    }
                    if (action === 'clear') {
                        if (!confirmClear) { confirmClear = true; show('清空后，下次出图时将重新生成。再次点击以确认。'); return; }
                        await dna.clear(scopeKey, name);
                        closeOverlay('close');
                        render();
                        return;
                    }
                    if (action === 'rewrite') {
                        show('正在由手机API生成……');
                        const written = await dna.write(scopeKey, name, { isUser });
                        for (const key of Object.keys(DNA_FRAMES)) {
                            const field = overlay.querySelector(`[data-dna-field="${key}"]`);
                            if (field) field.value = written.dna.views[key]?.subject || '';
                        }
                        overlay.querySelector('[data-dna-field="negative"]').value = written.dna.views.full_body?.negative || '';
                        overlay.querySelector('[data-dna-field="personality"]').value = written.dna.personality || '';
                        show('已生成并保存。');
                        render();
                    }
                } catch (error) {
                    show(error?.message || String(error));
                } finally {
                    if (button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
                }
            });
        });
    }

    function onClick(event) {
        const button = event.target.closest('[data-gallery-action]');
        if (!button || !page?.contains(button) || button.disabled) return;
        const action = button.dataset.galleryAction;
        notice = '';
        if (action === 'desktop') return deps.showPhoneDesktopPage?.();
        if (action === 'grid' || action === 'people' || action === 'settings') { view = action; return render(); }
        if (action === 'filter') { filter = Object.hasOwn(FILTERS, button.dataset.filter) ? button.dataset.filter : 'all'; limit = PAGE_SIZE; return render(); }
        if (action === 'scope') { scopeAll = !scopeAll; limit = PAGE_SIZE; return render(); }
        if (action === 'more') { limit += PAGE_SIZE; return render(); }
        if (action === 'view') return images().openViewer(button.dataset.imageId, { opener: button, onChange: render });
        if (action === 'edit-dna') return openDnaEditor(button.dataset.name);
        if (action === 'toggle') {
            const settings = loadImageSettings();
            saveImageSettings({ ...settings, [button.dataset.key]: !settings[button.dataset.key] });
            return render();
        }
        if (action === 'global-source') {
            const settings = loadImageSettings();
            const global = { ...settings.global, source: button.dataset.source };
            saveImageSettings({ ...settings, global });
            // 切到内置 NAI 但还没填 Key：直接打开全局方案让用户填。
            if (global.source === 'nai' && !global.nai.apiKey) {
                render();
                return openProfileEditor(GLOBAL_PROFILE_ID, { makeOverlay, closeOverlay, onSaved: render });
            }
            return render();
        }
        if (action === 'global-transport') {
            const settings = loadImageSettings();
            saveImageSettings({ ...settings, global: { ...settings.global, nai: { ...settings.global.nai, transport: button.dataset.transport } } });
            return render();
        }
        if (action === 'module-profile') {
            const settings = loadImageSettings();
            saveImageSettings({ ...settings, modules: { ...settings.modules, [button.dataset.module]: button.dataset.profile } });
            return render();
        }
        if (action === 'edit-profile' || action === 'new-profile') {
            return openProfileEditor(action === 'new-profile' ? 'new' : button.dataset.profile, { makeOverlay, closeOverlay, onSaved: render });
        }
    }

    const bind = phoneWindow => {
        if (boundWindow === phoneWindow || typeof phoneWindow?.addEventListener !== 'function') return;
        destroy();
        boundWindow = phoneWindow;
        lifecycle = new AbortController();
        phoneWindow.addEventListener('click', onClick, { signal: lifecycle.signal });
        unsubscribe = images()?.store.subscribe(() => { if (page && !page.hidden && view === 'grid') render(); });
    };
    function destroy() {
        lifecycle?.abort();
        lifecycle = null;
        unsubscribe?.();
        unsubscribe = null;
        boundWindow = null;
        page = null;
        renderSerial += 1;
    }
    const show = async ({ settings = false } = {}) => {
        page = deps.getPhoneWindow?.()?.querySelector?.('[data-phone-page="gallery"]');
        if (!page || !images()) return false;
        view = settings ? 'settings' : 'grid';
        filter = 'all';
        limit = PAGE_SIZE;
        notice = '';
        await images().store.importFromMetadata(storageId()).catch(() => 0);
        render();
        return globalThis.window?.__pmShowPhonePage?.('gallery') === true;
    };

    Object.assign(deps, { bindPhoneGalleryUi: bind, destroyPhoneGalleryUi: destroy, showPhoneGalleryPage: show });
    // 设置首页的「出图来源与生图方案」入口：关掉设置弹窗，直接进相册的生图设置页。
    if (globalThis.window) globalThis.window.__pmOpenImageSettings = () => { globalThis.window.__pmCloseOverlay?.(); return show({ settings: true }); };
    return { bind, destroy, show };
}
