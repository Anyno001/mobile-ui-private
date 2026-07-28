import { createWorldBookEntryKey, getCurrentChatWorldBooks, getTavernDbColumn, normalizeWorldBookConfig, WORLD_BOOK_MODULES } from './worldbook-config.js';
import { loadWorldBookConfig, saveWorldBookConfig } from './storage.js';
import { renderSettingsModal } from './settings-templates.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { BOOK_ICON_SVG, CALENDAR_ICON_SVG, CHAT_ICON_SVG, COMMUNITY_ICON_SVG, EYE_ICON_SVG, OUTFIT_ICON_SVG } from './icons.js';

const text = value => typeof value === 'string' ? value : '';
const HIDDEN_ENTRY_TITLE = /(?:^|-)包裹-(?:上|下)$/;
const WORLD_BOOK_BATCH_SIZE = 30;
const MODULE_LABELS = Object.freeze({ chat: '会话', calendar: '日历', outfit: '穿搭', community: '社区' });
const MODULE_ICONS = Object.freeze({ chat: CHAT_ICON_SVG, calendar: CALENDAR_ICON_SVG, outfit: OUTFIT_ICON_SVG, community: COMMUNITY_ICON_SVG });
const SOURCE_LABELS = Object.freeze({ global: '全局', chat: '聊天', character: '角色', additional: '附加' });
const DATABASE_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg>';
const shortTitle = value => value.length > 15 ? `${value.slice(0, 14)}…` : value;
const abortError = () => {
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    return error;
};

function normalizeWorldBookDetails(name, book) {
    const source = book && typeof book === 'object' && !Array.isArray(book) ? book.entries : null;
    const pairs = Array.isArray(source)
        ? source.map((value, index) => [index, value])
        : source && typeof source === 'object' ? Object.entries(source) : [];
    return pairs.flatMap(([fallbackUid, value]) => {
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
}

export async function loadWorldBookDetails(context, rawName, { signal } = {}) {
    const name = text(rawName).trim();
    if (!name || typeof context?.loadWorldInfo !== 'function') return null;
    if (signal?.aborted) throw abortError();
    let book;
    try { book = await context.loadWorldInfo(name); } catch (error) {
        if (signal?.aborted) throw abortError();
        if (error?.name === 'AbortError') throw error;
        return null;
    }
    if (signal?.aborted) throw abortError();
    return { name, entries: normalizeWorldBookDetails(name, book) };
}

export async function loadWorldBookSettingsDirectory(context, config, { signal } = {}) {
    if (typeof context?.getWorldInfoNames !== 'function' || signal?.aborted) return { current: [], others: [] };
    let names;
    try { names = await context.getWorldInfoNames(); } catch (error) { return { current: [], others: [] }; }
    if (signal?.aborted || !Array.isArray(names)) return { current: [], others: [] };
    const currentConfig = normalizeWorldBookConfig(config);
    const current = getCurrentChatWorldBooks(context).map(book => ({ ...book, enabled: currentConfig.books[book.name] !== false }));
    const currentNames = new Set(current.map(book => book.name));
    const others = [...new Set(names.map(name => text(name).trim()).filter(Boolean))]
        .filter(name => !currentNames.has(name)).map(name => ({ name, enabled: currentConfig.books[name] === true }));
    return { current, others };
}

export async function loadWorldBookDirectory(context, { signal } = {}) {
    if (typeof context?.loadWorldInfo !== 'function') return [];
    const selectedNames = getCurrentChatWorldBooks(context).map(book => book.name);
    const books = [];
    for (const rawName of selectedNames) {
        if (signal?.aborted) return [];
        const name = text(rawName).trim();
        if (!name) continue;
        const details = await loadWorldBookDetails(context, name, { signal });
        if (signal?.aborted) return [];
        if (details?.entries.length) books.push(details);
    }
    return books;
}

function eyeToggle(checked, dataset, label, disabled = false, onclick = '') {
    const handler = onclick || "this.classList.toggle('is-checked');this.setAttribute('aria-pressed',String(this.classList.contains('is-checked')))";
    return `<button type="button" class="pm-worldbook-eye ${checked ? 'is-checked' : ''}" aria-pressed="${checked}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" ${dataset}${disabled ? ' disabled' : ''} onclick="${handler}" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();this.click()}">${EYE_ICON_SVG}</button>`;
}

function visibleDatabaseColumns(books) {
    return [...new Set(books.flatMap(book => book.entries.map(entry => entry.column).filter(Boolean)))];
}

function renderDetail(detail, config) {
    if (detail.status === 'loading') return '<div class="pm-worldbook-detail-status" role="status">正在读取该世界书…</div>';
    if (detail.status === 'error') return `<div class="pm-worldbook-detail-status is-error" role="alert">读取失败。<button type="button" data-world-book-name="${escapeAttr(detail.name)}" onclick="window.__pmToggleWorldBookDetails(this.dataset.worldBookName,true)">重试</button></div>`;
    const entries = detail.entries || [];
    const columns = [...new Set(entries.map(entry => entry.column).filter(Boolean))];
    const nativeEntries = entries.filter(entry => !entry.column);
    const columnRows = columns.length ? `<div class="pm-worldbook-matrix"><div class="pm-worldbook-matrix-header"><span></span>${WORLD_BOOK_MODULES.map(module => `<span title="${MODULE_LABELS[module]}">${MODULE_ICONS[module]}<b>${MODULE_LABELS[module]}</b></span>`).join('')}</div>${columns.map(column => `<div class="pm-worldbook-matrix-row"><b title="${escapeAttr(column)}">${escapeHtml(column)}</b>${WORLD_BOOK_MODULES.map(module => eyeToggle(config.columns[column]?.[module] !== false, `data-world-column="${escapeAttr(column)}" data-world-module="${module}"`, `${column}：${MODULE_LABELS[module]}读取开关`, false, "this.classList.toggle('is-checked');this.setAttribute('aria-pressed',String(this.classList.contains('is-checked')));window.__pmSetWorldBookColumn(this)")).join('')}</div>`).join('')}</div>` : '<div class="pm-prof-empty">未发现数据库栏目。</div>';
    const nativeRows = nativeEntries.length ? nativeEntries.map(entry => `<div class="pm-li pm-worldbook-native-entry"><span><b title="${escapeAttr(entry.title)}">${escapeHtml(shortTitle(entry.title))}</b><small class="pm-group-sub">${entry.disabled ? '已禁用' : ''}</small></span>${eyeToggle(!entry.disabled && config.entries[entry.key] !== false, `data-world-entry="${escapeAttr(entry.key)}"`, `${detail.name} 条目读取开关`, entry.disabled, "this.classList.toggle('is-checked');this.setAttribute('aria-pressed',String(this.classList.contains('is-checked')));window.__pmSetWorldBookEntry(this)")}</div>`).join('') : '<div class="pm-prof-empty">未发现原生世界书条目。</div>';
    return `<div class="pm-worldbook-book-detail"><div class="pm-worldbook-section-heading">${DATABASE_ICON_SVG}<span>数据库栏目</span></div>${columnRows}<div class="pm-worldbook-section-heading">${BOOK_ICON_SVG}<span>原生条目</span></div>${nativeRows}</div>`;
}

function renderBookRow(book, state) {
    const expanded = state.detail?.name === book.name;
    const sources = Array.isArray(book.sources) ? book.sources.map(source => SOURCE_LABELS[source]).filter(Boolean) : [];
    const configured = Object.prototype.hasOwnProperty.call(state.config.books, book.name);
    const enabled = configured ? state.config.books[book.name] === true : sources.length > 0;
    return `<div class="pm-worldbook-native-book" data-world-book-section data-world-book-name="${escapeAttr(book.name)}" data-world-book-expanded="${expanded}"><div class="pm-li pm-worldbook-native-book-title"><button type="button" class="pm-worldbook-expand" data-world-book-name="${escapeAttr(book.name)}" aria-expanded="${expanded}" onclick="window.__pmToggleWorldBookDetails(this.dataset.worldBookName)"><span aria-hidden="true">›</span><b title="${escapeAttr(book.name)}">${escapeHtml(book.name)}</b>${sources.length ? `<small>${sources.join(' · ')}</small>` : ''}</button>${eyeToggle(enabled, `data-world-book="${escapeAttr(book.name)}"`, `${book.name}读取开关`, false, "this.classList.toggle('is-checked');this.setAttribute('aria-pressed',String(this.classList.contains('is-checked')));window.__pmSetWorldBookEnabled(this)")}</div>${expanded ? renderDetail(state.detail, state.config) : ''}</div>`;
}

function filteredOthers(state) {
    const query = state.search.trim().toLocaleLowerCase();
    return query ? state.directory.others.filter(book => book.name.toLocaleLowerCase().includes(query)) : state.directory.others;
}

function renderDirectoryLists(state) {
    const currentRows = state.directory.current.map(book => renderBookRow(book, state)).join('') || '<div class="pm-prof-empty">当前聊天未关联世界书。</div>';
    const matching = filteredOthers(state);
    const visible = matching.slice(0, state.otherLimit);
    const otherRows = visible.map(book => renderBookRow(book, state)).join('') || '<div class="pm-prof-empty">没有匹配的其他世界书。</div>';
    const more = visible.length < matching.length ? `<button type="button" class="pm-worldbook-load-more" onclick="window.__pmLoadMoreWorldBooks()">加载更多（剩余 ${matching.length - visible.length} 本）</button>` : '';
    return `<div class="pm-worldbook-columns"><section class="pm-worldbook-column"><div class="pm-worldbook-column-heading"><span><b>当前聊天世界书</b><small>${state.directory.current.length} 本</small></span></div><div class="pm-worldbook-native-list" data-world-book-current-list>${currentRows}</div></section><section class="pm-worldbook-column"><div class="pm-worldbook-column-heading"><span><b>其他世界书</b><small>${matching.length} 本</small></span><label class="pm-worldbook-search"><span class="sr-only">搜索其他世界书</span><input type="search" value="${escapeAttr(state.search)}" placeholder="搜索名称" oninput="window.__pmSearchWorldBooks(this.value)"></label></div><div class="pm-worldbook-native-list" data-world-book-other-list>${otherRows}</div>${more}</section></div>`;
}

function renderPage(state) {
    const config = state.config;
    return `<div class="pm-settings-page"><div class="pm-worldbook-range"><label class="pm-cfg-label">读取正文楼层数<input id="pm-world-main-messages" class="pm-cfg-input" type="number" min="1" max="100" value="${config.mainChatMessages}"></label><label class="pm-cfg-label">世界书扫描深度<input id="pm-world-scan-messages" class="pm-cfg-input" type="number" min="1" max="100" value="${config.scanMessages}"></label><label class="pm-cfg-label">发送世界书字符数上限<input id="pm-world-max-chars" class="pm-cfg-input" type="number" min="1000" max="80000" value="${config.maxChars}"></label></div><div class="pm-worldbook-content" data-world-book-directory>${renderDirectoryLists(state)}</div></div>`;
}

function renderColumnSelector({ title, module, scope, config, books, backAction = "window.__pmShowConfig('home')", backLabel = '返回设置' }) {
    const override = scope?.kind === 'group' ? config.groups[scope.id] : scope?.kind === 'character' ? config.characters[scope.id] : null;
    const columns = visibleDatabaseColumns(books);
    const rows = columns.length ? columns.map(name => {
        const checked = override?.columns?.[name]?.[module] ?? config.columns[name]?.[module] !== false;
        return `<div class="pm-li"><span><b>${escapeHtml(name)}</b></span>${eyeToggle(checked, `data-world-quick-column="${escapeAttr(name)}"`, `${title}：${name}读取开关`)}</div>`;
    }).join('') : '<div class="pm-prof-empty">未发现符合 TavernDB-ACU 协议的栏目。</div>';
    const reset = scope ? '<button class="pm-action-button is-secondary" onclick="window.__pmResetWorldBookColumnOverride()" style="flex:1">恢复跟随全局</button>' : '';
    return renderSettingsModal({ title, content: `<div class="pm-settings-page"><div class="pm-cfg-tip" style="text-align:left;padding:12px 14px">控制当前模块可读取的数据库条目。</div><div style="padding-bottom:12px">${rows}</div></div>`, footer: `<div class="pm-modal-add">${reset}<button class="pm-action-button is-accent" onclick="window.__pmSaveWorldBookColumns()" style="flex:2">完成</button></div>`, backAction, backLabel });
}

export function installWorldBookSettings({ makeOverlay, addNote, getCtx }) {
    let requestEpoch = 0;
    let requestController = null;
    let detailEpoch = 0;
    let detailController = null;
    let pageState = null;
    let quickSelector = null;
    let quickController = null;
    let contentLoadTail = Promise.resolve();
    const cloneConfig = config => structuredClone(normalizeWorldBookConfig(config));
    const enqueueContentLoad = task => {
        const pending = contentLoadTail.catch(() => {}).then(task);
        contentLoadTail = pending.catch(() => {});
        return pending;
    };
    const cancelDetail = () => {
        detailEpoch += 1;
        detailController?.abort();
        detailController = null;
        if (pageState) pageState.detail = null;
    };
    const cancelPendingPage = () => {
        requestEpoch += 1;
        requestController?.abort();
        requestController = null;
        quickController?.abort();
        quickController = null;
        quickSelector = null;
        cancelDetail();
        pageState = null;
    };
    const showQuickSelector = config => makeOverlay(renderColumnSelector({ ...quickSelector, config }), { onClose: reason => { if (reason !== 'replace') quickSelector = null; } });
    const isActivePage = state => pageState === state && document.getElementById('pm-overlay') === state.overlay;
    const rerenderLists = state => {
        if (!isActivePage(state)) return false;
        const root = state.overlay.querySelector('[data-world-book-directory]');
        if (!root) return false;
        root.innerHTML = renderDirectoryLists(state);
        return true;
    };
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
                if (!(committingOverlay && reason === 'replace') && epoch === requestEpoch) cancelPendingPage();
            };
        }
        const config = cloneConfig(loadWorldBookConfig());
        const directory = await loadWorldBookSettingsDirectory(getCtx(), config, { signal: controller.signal });
        if (epoch !== requestEpoch || controller.signal.aborted) return false;
        const state = { config, directory, search: '', otherLimit: WORLD_BOOK_BATCH_SIZE, detail: null, overlay: null };
        const footer = '<div class="pm-modal-add"><button class="pm-action-button is-secondary" onclick="window.__pmResetWorldBookConfig()" style="flex:1">恢复默认</button><button class="pm-action-button is-accent" onclick="window.__pmSaveWorldBookConfig()" style="flex:2">保存世界书设置</button></div>';
        committingOverlay = true;
        try {
            state.overlay = makeOverlay(renderSettingsModal({ title: '世界书读取', content: renderPage(state), footer }), {
                onClose: reason => { if (reason !== 'replace' && pageState === state) cancelPendingPage(); },
            });
            pageState = state;
        } finally {
            committingOverlay = false;
        }
        return true;
    };
    window.__pmSetWorldBookEnabled = control => {
        if (!pageState || !control?.dataset.worldBook) return false;
        pageState.config.books[control.dataset.worldBook] = control.classList.contains('is-checked');
        return true;
    };
    window.__pmSetWorldBookEntry = control => {
        if (!pageState || !control?.dataset.worldEntry) return false;
        pageState.config.entries[control.dataset.worldEntry] = control.classList.contains('is-checked');
        return true;
    };
    window.__pmSetWorldBookColumn = control => {
        if (!pageState || !control?.dataset.worldColumn || !WORLD_BOOK_MODULES.includes(control.dataset.worldModule)) return false;
        const column = control.dataset.worldColumn, module = control.dataset.worldModule;
        pageState.config.columns[column] = { ...pageState.config.columns[column], [module]: control.classList.contains('is-checked') };
        return true;
    };
    window.__pmSearchWorldBooks = value => {
        if (!pageState) return false;
        cancelDetail();
        pageState.search = text(value);
        pageState.otherLimit = WORLD_BOOK_BATCH_SIZE;
        const updated = rerenderLists(pageState);
        const input = pageState?.overlay?.querySelector('.pm-worldbook-search input');
        input?.focus({ preventScroll: true });
        input?.setSelectionRange?.(input.value.length, input.value.length);
        return updated;
    };
    window.__pmLoadMoreWorldBooks = () => {
        if (!pageState) return false;
        pageState.otherLimit += WORLD_BOOK_BATCH_SIZE;
        return rerenderLists(pageState);
    };
    window.__pmToggleWorldBookDetails = async (rawName, retry = false) => {
        const state = pageState;
        const name = text(rawName).trim();
        if (!state || !name || !isActivePage(state)) return false;
        if (!retry && state.detail?.name === name) {
            cancelDetail();
            rerenderLists(state);
            return true;
        }
        cancelDetail();
        const epoch = detailEpoch;
        const controller = new AbortController();
        detailController = controller;
        state.detail = { name, status: 'loading', entries: [] };
        rerenderLists(state);
        try {
            const details = await enqueueContentLoad(() => {
                if (epoch !== detailEpoch || controller.signal.aborted || !isActivePage(state)) throw abortError();
                return loadWorldBookDetails(getCtx(), name, { signal: controller.signal });
            });
            if (epoch !== detailEpoch || controller.signal.aborted || !isActivePage(state)) return false;
            detailController = null;
            state.detail = details ? { ...details, status: 'loaded' } : { name, status: 'error', entries: [] };
            rerenderLists(state);
            return Boolean(details);
        } catch (error) {
            if (epoch !== detailEpoch || controller.signal.aborted || error?.name === 'AbortError' || !isActivePage(state)) return false;
            detailController = null;
            state.detail = { name, status: 'error', entries: [] };
            rerenderLists(state);
            return false;
        }
    };
    window.__pmShowWorldBookColumns = async ({ title, module, scope = null, backAction, backLabel } = {}) => {
        if (!WORLD_BOOK_MODULES.includes(module)) return false;
        cancelPendingPage();
        const controller = new AbortController();
        quickController = controller;
        const books = await enqueueContentLoad(() => {
            if (controller.signal.aborted || quickController !== controller) throw abortError();
            return loadWorldBookDirectory(getCtx(), { signal: controller.signal });
        }).catch(error => error?.name === 'AbortError' ? null : Promise.reject(error));
        if (!books) return false;
        if (controller.signal.aborted || quickController !== controller) return false;
        quickController = null;
        const config = loadWorldBookConfig();
        quickSelector = { title: text(title).trim() || `${MODULE_LABELS[module]}可读的数据库记忆`, module, scope, books, backAction, backLabel };
        showQuickSelector(config);
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
        showQuickSelector(candidate);
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
        if (!pageState) return false;
        const candidate = cloneConfig(pageState.config);
        candidate.mainChatMessages = Number(document.getElementById('pm-world-main-messages')?.value);
        candidate.scanMessages = Number(document.getElementById('pm-world-scan-messages')?.value);
        candidate.maxChars = Number(document.getElementById('pm-world-max-chars')?.value);
        if (!saveWorldBookConfig(candidate)) { alert('世界书设置保存失败：浏览器存储不可用'); return false; }
        cancelPendingPage(); document.getElementById('pm-overlay')?.remove(); addNote('世界书读取设置已保存'); return true;
    };
    window.__pmResetWorldBookConfig = async () => { if (!saveWorldBookConfig(null)) { alert('世界书设置重置失败：浏览器存储不可用'); return false; } await showPage(); return true; };
    return { showPage, cancelPendingPage };
}
