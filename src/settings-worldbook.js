import { createWorldBookEntryKey, getEnabledWorldBookNames, getTavernDbColumn, hasWorldBookSelectionSource, normalizeWorldBookConfig, WORLD_BOOK_MODULES } from './worldbook-config.js';
import { loadWorldBookConfig, saveWorldBookConfig } from './storage.js';
import { renderSettingsModal } from './settings-templates.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { BOOK_ICON_SVG, CALENDAR_ICON_SVG, CHAT_ICON_SVG, COMMUNITY_ICON_SVG, EYE_ICON_SVG } from './icons.js';

const text = value => typeof value === 'string' ? value : '';
const HIDDEN_ENTRY_TITLE = /(?:^|-)包裹-(?:上|下)$/;
const MODULE_LABELS = Object.freeze({ chat: '会话', calendar: '日历', community: '社区' });
const MODULE_ICONS = Object.freeze({ chat: CHAT_ICON_SVG, calendar: CALENDAR_ICON_SVG, community: COMMUNITY_ICON_SVG });
const isCurrentRequest = (epoch, controller, currentEpoch) => epoch === currentEpoch() && !controller.signal.aborted;
const DATABASE_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg>';
const shortTitle = value => value.length > 15 ? `${value.slice(0, 14)}…` : value;

export async function loadWorldBookDirectory(context, { signal } = {}) {
    if (typeof context?.getWorldInfoNames !== 'function' || typeof context?.loadWorldInfo !== 'function') return [];
    if (signal?.aborted) return [];
    let names;
    try { names = await context.getWorldInfoNames(); } catch (error) { return []; }
    if (signal?.aborted || !Array.isArray(names)) return [];
    const enabledNames = getEnabledWorldBookNames(context);
    const selectedNames = hasWorldBookSelectionSource(context) ? names.filter(name => enabledNames.has(text(name).trim())) : names;
    const books = [];
    for (const rawName of selectedNames) {
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
            const title = text(value.comment).trim() || `条目 ${uid}`;
            const column = getTavernDbColumn(value.comment);
            if (HIDDEN_ENTRY_TITLE.test(title) && !column) return [];
            return [{ key, uid: String(uid), title, column, disabled: value.disable === true || value.enabled === false }];
        }).sort((left, right) => left.uid.localeCompare(right.uid, undefined, { numeric: true }));
        if (entries.length) books.push({ name, entries });
    }
    return books;
}

function eyeToggle(checked, dataset, label, disabled = false) {
    return `<button type="button" class="pm-worldbook-eye ${checked ? 'is-checked' : ''}" aria-pressed="${checked}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" ${dataset}${disabled ? ' disabled' : ''} onclick="this.classList.toggle('is-checked');this.setAttribute('aria-pressed',String(this.classList.contains('is-checked')))" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}">${EYE_ICON_SVG}</button>`;
}

function bookToggle(checked, bookName) {
    return `<button type="button" class="pm-worldbook-eye ${checked ? 'is-checked' : ''}" aria-pressed="${checked}" aria-label="${escapeAttr(`${bookName}读取开关`)}" title="${escapeAttr(`${bookName}读取开关`)}" data-world-book="${escapeAttr(bookName)}" onclick="this.classList.toggle('is-checked');const enabled=this.classList.contains('is-checked');this.setAttribute('aria-pressed',String(enabled));this.closest('[data-world-book-section]').querySelector('[data-world-book-entries]').hidden=!enabled" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}">${EYE_ICON_SVG}</button>`;
}

function visibleDatabaseColumns(books) {
    return [...new Set(books.flatMap(book => book.entries.map(entry => entry.column).filter(Boolean)))];
}

function renderPage(config, books) {
    const columns = visibleDatabaseColumns(books);
    const columnRows = columns.length ? `<div class="pm-worldbook-matrix"><div class="pm-worldbook-matrix-header"><span></span>${WORLD_BOOK_MODULES.map(module => `<span title="${MODULE_LABELS[module]}">${MODULE_ICONS[module]}<b>${MODULE_LABELS[module]}</b></span>`).join('')}</div>${columns.map(column => `<div class="pm-worldbook-matrix-row"><b title="${escapeAttr(column)}">${escapeHtml(column)}</b>${WORLD_BOOK_MODULES.map(module => eyeToggle(config.columns[column]?.[module] !== false, `data-world-column="${escapeAttr(column)}" data-world-module="${module}"`, `${column}：${MODULE_LABELS[module]}读取开关`)).join('')}</div>`).join('')}</div>` : '<div class="pm-prof-empty">未发现符合 TavernDB-ACU-CustomExport 协议的栏目。</div>';
    const entryRows = books.map(book => {
        const entries = book.entries.filter(entry => !entry.column);
        if (!entries.length) return '';
        const enabled = config.books[book.name] !== false;
        return `<div data-world-book-section style="padding:10px 14px;border-top:1px solid var(--pm-color-border-subtle)"><div class="pm-li" style="min-height:34px"><span><b title="${escapeAttr(book.name)}">${escapeHtml(shortTitle(book.name))}</b></span>${bookToggle(enabled, book.name)}</div><div data-world-book-entries${enabled ? '' : ' hidden'}>${entries.map(entry => `<div class="pm-li"><span><b title="${escapeAttr(entry.title)}">${escapeHtml(shortTitle(entry.title))}</b><small class="pm-group-sub">${entry.disabled ? '已禁用' : ''}</small></span>${eyeToggle(!entry.disabled && config.entries[entry.key] !== false, `data-world-entry="${escapeAttr(entry.key)}"`, `${book.name} 条目读取开关`, entry.disabled)}</div>`).join('')}</div></div>`;
    }).join('') || '<div class="pm-prof-empty">未发现不属于 TavernDB 栏目的原生世界书条目。</div>';
    const hasColumns = columns.length > 0;
    return `<div class="pm-settings-page"><div class="pm-worldbook-range"><label class="pm-cfg-label">读取正文楼层数<input id="pm-world-main-messages" class="pm-cfg-input" type="number" min="1" max="100" value="${config.mainChatMessages}"></label><label class="pm-cfg-label">世界书扫描深度<input id="pm-world-scan-messages" class="pm-cfg-input" type="number" min="1" max="100" value="${config.scanMessages}"></label><label class="pm-cfg-label">发送世界书字符数上限<input id="pm-world-max-chars" class="pm-cfg-input" type="number" min="1000" max="80000" value="${config.maxChars}"></label></div><div class="pm-worldbook-content ${hasColumns ? 'has-columns' : ''}"><div class="pm-worldbook-section-heading">${DATABASE_ICON_SVG}<span>数据库条目一览</span></div>${columnRows}<div class="pm-worldbook-native-list"><div class="pm-worldbook-section-heading">${BOOK_ICON_SVG}<span>原生世界书条目</span></div>${entryRows}</div></div></div>`;
}

function renderColumnSelector({ title, module, scope, config, books, backAction = "window.__pmShowConfig('home')", backLabel = '返回设置' }) {
    const override = scope?.kind === 'group' ? config.groups[scope.id] : scope?.kind === 'character' ? config.characters[scope.id] : null;
    const columns = visibleDatabaseColumns(books);
    const rows = columns.length ? columns.map(name => {
        const checked = override?.columns?.[name]?.[module] ?? config.columns[name]?.[module] !== false;
        return `<div class="pm-li"><span><b>${escapeHtml(name)}</b></span>${eyeToggle(checked, `data-world-quick-column="${escapeAttr(name)}"`, `${title}：${name}读取开关`)}</div>`;
    }).join('') : '<div class="pm-prof-empty">未发现符合 TavernDB-ACU 协议的栏目。</div>';
    const reset = scope ? '<button class="pm-action-button is-secondary" onclick="window.__pmResetWorldBookColumnOverride()" style="flex:1">恢复跟随全局</button>' : '';
    return renderSettingsModal({ title, content: `<div class="pm-settings-page"><div class="pm-cfg-tip" style="text-align:left;padding:12px 14px">控制当前模块可读取的数据库条目。</div><div style="padding-bottom:12px">${rows}</div></div>`, footer: `<div class="pm-modal-add">${reset}<button class="pm-action-button" onclick="window.__pmSaveWorldBookColumns()" style="flex:2">完成</button></div>`, backAction, backLabel });
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
    window.__pmShowWorldBookColumns = async ({ title, module, scope = null, backAction, backLabel } = {}) => {
        if (!WORLD_BOOK_MODULES.includes(module)) return false;
        const config = loadWorldBookConfig();
        const books = await loadWorldBookDirectory(getCtx());
        quickSelector = { title: text(title).trim() || `${MODULE_LABELS[module]}可读的数据库记忆`, module, scope, books, backAction, backLabel };
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
        const candidate = { ...current, books: { ...current.books }, entries: { ...current.entries }, columns: { ...current.columns }, mainChatMessages: Number(document.getElementById('pm-world-main-messages')?.value), scanMessages: Number(document.getElementById('pm-world-scan-messages')?.value), maxChars: Number(document.getElementById('pm-world-max-chars')?.value) };
        document.querySelectorAll('[data-world-book]').forEach(control => { candidate.books[control.dataset.worldBook] = control.classList.contains('is-checked'); });
        document.querySelectorAll('[data-world-entry]').forEach(control => { candidate.entries[control.dataset.worldEntry] = control.classList.contains('is-checked'); });
        document.querySelectorAll('[data-world-column]').forEach(control => { const column = control.dataset.worldColumn, module = control.dataset.worldModule; candidate.columns[column] = { ...candidate.columns[column], [module]: control.classList.contains('is-checked') }; });
        if (!saveWorldBookConfig(candidate)) { alert('世界书设置保存失败：浏览器存储不可用'); return false; }
        document.getElementById('pm-overlay')?.remove(); addNote('世界书读取设置已保存'); return true;
    };
    window.__pmResetWorldBookConfig = async () => { if (!saveWorldBookConfig(null)) { alert('世界书设置重置失败：浏览器存储不可用'); return false; } await showPage(); return true; };
    return { showPage, cancelPendingPage };
}
