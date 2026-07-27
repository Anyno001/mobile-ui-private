import { createWorldBookEntryKey, getTavernDbColumn, normalizeWorldBookConfig, WORLD_BOOK_MODULES } from './worldbook-config.js';
import { loadWorldBookConfig, saveWorldBookConfig } from './storage.js';
import { renderSettingsModal } from './settings-templates.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { EYE_ICON_SVG } from './icons.js';

const text = value => typeof value === 'string' ? value : '';
const MODULE_LABELS = Object.freeze({ chat: '聊天', calendar: '日历', community: '社区' });
const isCurrentRequest = (epoch, controller, currentEpoch) => epoch === currentEpoch() && !controller.signal.aborted;
const DATABASE_ICON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg>';

export async function loadWorldBookDirectory(context, { signal } = {}) {
    if (typeof context?.getWorldInfoNames !== 'function' || typeof context?.loadWorldInfo !== 'function') return [];
    if (signal?.aborted) return [];
    let names;
    try { names = await context.getWorldInfoNames(); } catch (error) { return []; }
    if (signal?.aborted || !Array.isArray(names)) return [];
    const books = [];
    for (const rawName of names) {
        if (signal?.aborted) return [];
        const name = text(rawName).trim();
        if (!name) continue;
        let book;
        try { book = await context.loadWorldInfo(name); } catch (error) { continue; }
        if (signal?.aborted) return [];
        const source = book && typeof book === 'object' && !Array.isArray(book) ? book.entries : null;
        if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
        const entries = Object.entries(source).flatMap(([fallbackUid, value]) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
            const uid = value.uid ?? value.id ?? fallbackUid;
            const key = createWorldBookEntryKey(name, uid);
            const content = text(value.content).trim();
            if (!key || !content) return [];
            return [{ key, uid: String(uid), content, column: getTavernDbColumn(value.comment), disabled: value.disable === true || value.enabled === false }];
        }).sort((left, right) => left.uid.localeCompare(right.uid, undefined, { numeric: true }));
        if (entries.length) books.push({ name, entries });
    }
    return books;
}

function toggle(id, checked, dataset, label, icon = '') {
    return `<button${id ? ` id="${id}"` : ''} type="button" class="pm-custom-check ${checked ? 'is-checked' : ''}" role="checkbox" aria-checked="${checked}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" ${dataset} onclick="this.classList.toggle('is-checked');this.setAttribute('aria-checked',String(this.classList.contains('is-checked')))" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}">${icon}</button>`;
}

function renderPage(config, books) {
    const columns = [...new Set(books.flatMap(book => book.entries.map(entry => entry.column).filter(Boolean)))];
    const columnRows = columns.length ? columns.map(column => `<div style="padding:8px 0;border-top:1px solid var(--pm-color-border-subtle)"><div class="pm-cfg-label" style="margin:0 0 6px"><b>${escapeHtml(column)}</b><small class="pm-group-sub">TavernDB 栏目</small></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:6px">${WORLD_BOOK_MODULES.map(module => `<label class="pm-cfg-label" style="margin:0;display:flex;align-items:center;justify-content:space-between;gap:4px;min-width:0"><span>${MODULE_LABELS[module]}</span>${toggle('', config.columns[column]?.[module] !== false, `data-world-column="${escapeAttr(column)}" data-world-module="${module}"`, `${column}：${MODULE_LABELS[module]}读取开关`, EYE_ICON_SVG)}</label>`).join('')}</div></div>`).join('') : '<div class="pm-prof-empty">未发现符合 TavernDB-ACU-CustomExport 协议的栏目。</div>';
    const entryRows = books.map(book => {
        const entries = book.entries.filter(entry => !entry.column);
        if (!entries.length) return '';
        return `<div style="padding:10px 14px;border-top:1px solid var(--pm-color-border-subtle)"><div class="pm-cfg-label" style="margin:0 0 6px"><b>${escapeHtml(book.name)}</b></div>${entries.map(entry => `<div class="pm-li"><span><b>${escapeHtml(entry.content.slice(0, 48))}</b><small class="pm-group-sub">UID ${escapeHtml(entry.uid)}${entry.disabled ? ' · 宿主已禁用' : ''}</small></span>${toggle('', config.entries[entry.key] !== false, `data-world-entry="${escapeAttr(entry.key)}"`, `${book.name} 条目 ${entry.uid} 读取开关`, EYE_ICON_SVG)}</div>`).join('')}</div>`;
    }).join('') || '<div class="pm-prof-empty">未发现不属于 TavernDB 栏目的原生世界书条目。</div>';
    return `<div class="pm-settings-page"><div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px"><div class="pm-cfg-tip" style="text-align:left">只影响天音小笺自身读取，不修改宿主开关、世界书文件或主聊天注入。</div><div class="pm-cfg-label" style="margin:0">读取范围</div><div class="pm-cfg-tip" style="text-align:left">主线正文用于提示词参考；扫描窗口仅决定哪些世界书条目会被触发。</div><label class="pm-cfg-label">主线正文条数<input id="pm-world-main-messages" class="pm-cfg-input" type="number" min="1" max="100" value="${config.mainChatMessages}"></label><label class="pm-cfg-label">世界书扫描条数<input id="pm-world-scan-messages" class="pm-cfg-input" type="number" min="1" max="100" value="${config.scanMessages}"></label><label class="pm-cfg-label">世界书字符上限<input id="pm-world-max-chars" class="pm-cfg-input" type="number" min="1000" max="80000" value="${config.maxChars}"></label></div><div style="padding:10px 14px;border-top:1px solid var(--pm-color-border-subtle)"><div class="pm-cfg-label" style="margin-bottom:6px;display:flex;align-items:center;gap:6px">${DATABASE_ICON_SVG}<span>TavernDB 栏目读取矩阵</span></div>${columnRows}</div><div style="padding-bottom:12px"><div class="pm-cfg-label" style="padding:10px 14px 4px;display:flex;align-items:center;gap:6px">${EYE_ICON_SVG}<span>原生世界书条目</span></div>${entryRows}</div></div>`;
}

function columnNames(books) {
    return [...new Set(books.flatMap(book => book.entries.map(entry => entry.column).filter(Boolean)))];
}

function renderColumnSelector({ title, module, scope, config, books }) {
    const override = scope?.kind === 'group' ? config.groups[scope.id] : scope?.kind === 'character' ? config.characters[scope.id] : null;
    const columns = columnNames(books);
    const rows = columns.length ? columns.map(column => {
        const checked = override?.columns?.[column]?.[module] ?? config.columns[column]?.[module] !== false;
        return `<div class="pm-li"><span><b>${escapeHtml(column)}</b><small class="pm-group-sub">TavernDB 栏目</small></span>${toggle('', checked, `data-world-quick-column="${escapeAttr(column)}"`, `${title}：${column}读取开关`, EYE_ICON_SVG)}</div>`;
    }).join('') : '<div class="pm-prof-empty">未发现符合 TavernDB-ACU-CustomExport 协议的栏目。</div>';
    const reset = scope ? '<button class="pm-action-button is-secondary" onclick="window.__pmResetWorldBookColumnOverride()" style="flex:1">恢复跟随全局</button>' : '';
    return renderSettingsModal({ title, content: `<div class="pm-settings-page"><div class="pm-cfg-tip" style="text-align:left;padding:12px 14px">${scope ? '当前选择仅作用于此处；恢复后继续跟随全局读取设置。' : `直接修改全局“${MODULE_LABELS[module]}”读取列。`}</div><div style="padding-bottom:12px">${rows}</div></div>`, footer: `<div class="pm-modal-add">${reset}<button class="pm-action-button" onclick="window.__pmSaveWorldBookColumns()" style="flex:2">完成</button></div>` });
}

export function installWorldBookSettings({ makeOverlay, addNote, getCtx }) {
    let requestEpoch = 0;
    let requestController = null;
    const cancelRequest = (epoch, controller) => {
        if (epoch !== requestEpoch || controller !== requestController) return;
        requestEpoch += 1;
        controller.abort();
        requestController = null;
    };
    const cancelPendingPage = () => {
        if (requestController) cancelRequest(requestEpoch, requestController);
    };
    let quickSelector = null;
    const cloneConfig = config => structuredClone(normalizeWorldBookConfig(config));
    const showPage = async () => {
        cancelPendingPage();
        const epoch = requestEpoch;
        const controller = new AbortController();
        requestController = controller;
        let committingOverlay = false;
        const previousOverlay = document.getElementById('pm-overlay');
        if (previousOverlay) {
            const previousOnClose = previousOverlay.__pmOnClose;
            previousOverlay.__pmOnClose = reason => {
                if (typeof previousOnClose === 'function') previousOnClose(reason);
                if (!(committingOverlay && reason === 'replace')) cancelRequest(epoch, controller);
            };
        }
        const config = loadWorldBookConfig();
        const books = await loadWorldBookDirectory(getCtx(), { signal: controller.signal });
        if (!isCurrentRequest(epoch, controller, () => requestEpoch)) return false;
        const footer = '<div class="pm-modal-add"><button class="pm-action-button is-secondary" onclick="window.__pmResetWorldBookConfig()" style="flex:1">恢复默认</button><button class="pm-action-button" onclick="window.__pmSaveWorldBookConfig()" style="flex:2">保存世界书设置</button></div>';
        committingOverlay = true;
        try {
            makeOverlay(renderSettingsModal({ title: '世界书读取', content: renderPage(config, books), footer }), {
                onClose: reason => { if (reason !== 'replace') cancelRequest(epoch, controller); },
            });
        } finally {
            committingOverlay = false;
        }
        return true;
    };
    window.__pmShowWorldBookColumns = async ({ title, module, scope = null } = {}) => {
        if (!WORLD_BOOK_MODULES.includes(module)) return false;
        const config = loadWorldBookConfig();
        const books = await loadWorldBookDirectory(getCtx());
        quickSelector = { title: text(title).trim() || `${MODULE_LABELS[module]}可读的数据库记忆`, module, scope, books };
        makeOverlay(renderColumnSelector({ ...quickSelector, config }));
        return true;
    };
    window.__pmSaveWorldBookColumns = () => {
        if (!quickSelector) return false;
        const current = normalizeWorldBookConfig(window.__pmWorldBookConfig);
        const candidate = cloneConfig(current);
        const { module, scope } = quickSelector;
        const target = scope?.kind === 'group' ? candidate.groups : scope?.kind === 'character' ? candidate.characters : null;
        const id = text(scope?.id).trim();
        if (target && !id) return false;
        const override = target ? (target[id] = { ...(target[id] || {}), entries: { ...(target[id]?.entries || {}) }, columns: { ...(target[id]?.columns || {}) } }) : candidate;
        document.querySelectorAll('[data-world-quick-column]').forEach(control => {
            const column = control.dataset.worldQuickColumn;
            override.columns[column] = { ...override.columns[column], [module]: control.classList.contains('is-checked') };
        });
        if (!saveWorldBookConfig(candidate)) { alert('世界书设置保存失败：浏览器存储不可用'); return false; }
        document.getElementById('pm-overlay')?.remove(); addNote('世界书读取设置已保存'); quickSelector = null; return true;
    };
    window.__pmResetWorldBookColumnOverride = () => {
        if (!quickSelector?.scope) return false;
        const current = normalizeWorldBookConfig(window.__pmWorldBookConfig);
        const candidate = cloneConfig(current);
        const target = quickSelector.scope.kind === 'group' ? candidate.groups : candidate.characters;
        const id = text(quickSelector.scope.id).trim();
        if (!id) return false;
        const existing = target[id];
        if (existing) {
            const columns = { ...existing.columns };
            for (const column of Object.keys(columns)) {
                const modes = { ...columns[column] };
                delete modes[quickSelector.module];
                if (Object.keys(modes).length) columns[column] = modes;
                else delete columns[column];
            }
            const next = { ...existing, columns };
            if (!Object.keys(next.entries || {}).length && !Object.keys(columns).length && !next.allowMemberPrivateMemory) delete target[id];
            else target[id] = next;
        }
        if (!saveWorldBookConfig(candidate)) { alert('世界书设置重置失败：浏览器存储不可用'); return false; }
        makeOverlay(renderColumnSelector({ ...quickSelector, config: candidate }));
        return true;
    };
    window.__pmSetGroupMemberPrivateMemory = (groupId, enabled) => {
        const id = text(groupId).trim();
        if (!id) return false;
        const candidate = cloneConfig(window.__pmWorldBookConfig);
        candidate.groups[id] = { ...(candidate.groups[id] || {}), entries: { ...(candidate.groups[id]?.entries || {}) }, columns: { ...(candidate.groups[id]?.columns || {}) }, allowMemberPrivateMemory: enabled === true };
        if (!saveWorldBookConfig(candidate)) { alert('成员私人记忆设置保存失败：浏览器存储不可用'); return false; }
        return true;
    };
    window.__pmToggleGroupMemberPrivateMemory = groupId => {
        const id = text(groupId).trim();
        if (!id) return false;
        const enabled = window.__pmWorldBookConfig?.groups?.[id]?.allowMemberPrivateMemory === true;
        if (!enabled && !confirm('开启后，群聊会载入成员在私人窗口中启用的数据库栏目。群聊使用共享模型上下文，角色间隔离依赖提示词约束，并非严格数据隔离。')) return false;
        const saved = window.__pmSetGroupMemberPrivateMemory(id, !enabled);
        if (saved) window.__pmEditGroup?.();
        return saved;
    };
    window.__pmSaveWorldBookConfig = () => {
        const current = normalizeWorldBookConfig(window.__pmWorldBookConfig);
        const candidate = { ...current, entries: { ...current.entries }, columns: { ...current.columns }, mainChatMessages: Number(document.getElementById('pm-world-main-messages')?.value), scanMessages: Number(document.getElementById('pm-world-scan-messages')?.value), maxChars: Number(document.getElementById('pm-world-max-chars')?.value) };
        document.querySelectorAll('[data-world-entry]').forEach(control => { candidate.entries[control.dataset.worldEntry] = control.classList.contains('is-checked'); });
        document.querySelectorAll('[data-world-column]').forEach(control => { const column = control.dataset.worldColumn, module = control.dataset.worldModule; candidate.columns[column] = { ...candidate.columns[column], [module]: control.classList.contains('is-checked') }; });
        if (!saveWorldBookConfig(candidate)) { alert('世界书设置保存失败：浏览器存储不可用'); return false; }
        document.getElementById('pm-overlay')?.remove(); addNote('世界书读取设置已保存'); return true;
    };
    window.__pmResetWorldBookConfig = async () => { if (!saveWorldBookConfig(null)) { alert('世界书设置重置失败：浏览器存储不可用'); return false; } await showPage(); return true; };
    return { showPage, cancelPendingPage };
}
