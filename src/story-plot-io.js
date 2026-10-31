// 剧情页用到的弹窗、下载、选文件、读世界书。弹窗都走手机的 makeOverlay，样式沿用设置页的 pm-modal。
import { CLOSE_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { getReadableWorldBookNames } from './worldbook-config.js';

function modal(title, body, actions) {
    return `<div class="pm-modal pm-modal-wide" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}"><div class="pm-modal-header"><span></span><b>${escapeHtml(title)}</b><button type="button" class="pm-modal-close" data-plot-dialog="cancel" aria-label="关闭" title="关闭">${CLOSE_ICON_SVG}</button></div>
      <div class="pm-modal-scroll pm-settings-list">${body}</div>
      <div class="pm-modal-add">${actions.map(item => `<button type="button" class="pm-action-button ${item.primary ? 'is-accent' : 'is-secondary'}" data-plot-dialog="${escapeAttr(item.value)}">${escapeHtml(item.label)}</button>`).join('')}</div></div>`;
}

// 通用弹窗：resolve 点的按钮值（read 先读出表单），关闭或取消为 null。
export function openPlotDialog(deps, { title, body = '', actions = [{ label: '取消', value: 'cancel' }, { label: '确定', value: 'ok', primary: true }], read = () => true }) {
    return new Promise(resolve => {
        if (typeof deps.makeOverlay !== 'function') { resolve(null); return; }
        let settled = false;
        const done = value => { if (!settled) { settled = true; resolve(value); } };
        const overlay = deps.makeOverlay(modal(title, body, actions), { onClose: () => done(null) });
        overlay?.addEventListener('click', event => {
            const button = event.target.closest?.('[data-plot-dialog]');
            if (!button) return;
            const value = button.dataset.plotDialog;
            if (value === 'cancel') { deps.closeOverlay?.('close'); return; }
            const result = value === 'ok' ? read(overlay) : { action: value, form: read(overlay) };
            done(result);
            deps.closeOverlay?.('close');
        });
        overlay?.querySelector('textarea, input, select')?.focus?.({ preventScroll: true });
    });
}

export function promptText(deps, { title, label = '', value = '', multiline = false, placeholder = '', rows = 8 }) {
    const field = multiline
        ? `<textarea class="pm-cfg-input" name="value" rows="${rows}" placeholder="${escapeAttr(placeholder)}">${escapeHtml(value)}</textarea>`
        : `<input class="pm-cfg-input" name="value" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}">`;
    return openPlotDialog(deps, {
        title,
        body: `<label class="pm-settings-field"><span class="pm-cfg-label">${escapeHtml(label || title)}</span>${field}</label>`,
        read: overlay => overlay.querySelector('[name="value"]')?.value ?? '',
    });
}

export function pickOption(deps, { title, options, value }) {
    return openPlotDialog(deps, {
        title,
        body: `<div class="pm-plot-choice" role="radiogroup">${options.map(item => `<label class="pm-plot-choice-item"><input type="radio" name="choice" value="${escapeAttr(item.value)}" ${String(item.value) === String(value) ? 'checked' : ''}><span><b>${escapeHtml(item.label)}</b>${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}</span></label>`).join('')}</div>`,
        read: overlay => overlay.querySelector('[name="choice"]:checked')?.value ?? null,
    });
}

// 多选清单：返回选中项的 value 数组；取消为 null。
export function pickMany(deps, { title, items, okLabel = '确定', hint = '' }) {
    return openPlotDialog(deps, {
        title,
        body: `${hint ? `<p class="pm-plot-dialog-hint">${escapeHtml(hint)}</p>` : ''}<div class="pm-plot-choice">${items.map(item => `<label class="pm-plot-choice-item"><input type="checkbox" name="pick" value="${escapeAttr(item.value)}" ${item.checked ? 'checked' : ''}><span><b>${escapeHtml(item.label)}</b>${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}</span></label>`).join('') || '<p class="pm-plot-dialog-hint">没有可选的内容。</p>'}</div>`,
        actions: [{ label: '取消', value: 'cancel' }, { label: okLabel, value: 'ok', primary: true }],
        read: overlay => [...overlay.querySelectorAll('[name="pick"]:checked')].map(input => input.value),
    });
}

export function showText(deps, { title, text }) {
    return openPlotDialog(deps, {
        title,
        body: `<pre class="pm-plot-pre">${escapeHtml(text)}</pre>`,
        actions: [{ label: '复制', value: 'copy' }, { label: '关闭', value: 'cancel', primary: true }],
        read: () => text,
    }).then(result => {
        if (result?.action === 'copy') return globalThis.navigator?.clipboard?.writeText?.(text).then(() => true, () => false);
        return false;
    });
}

export function downloadText(name, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickTextFile(accept = '.json,.yaml,.yml,.txt') {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            resolve(file ? { name: file.name, text: await file.text() } : null);
        }, { once: true });
        input.click();
    });
}

// 当前聊天可读的世界书条目（与剧情助手的阅读范围一致）。
export async function readWorldBookEntries(getCtx) {
    const ctx = getCtx?.();
    let names = [];
    try { names = getReadableWorldBookNames(ctx, globalThis.window?.__pmWorldBookConfig); } catch (error) { names = []; }
    const out = [];
    for (const name of names) {
        try {
            const data = await ctx?.loadWorldInfo?.(name);
            for (const [key, entry] of Object.entries(data?.entries || {})) {
                const content = String(entry?.content || '').trim();
                if (!content) continue;
                const title = String(entry.comment || '').trim() || [].concat(entry.key || []).slice(0, 3).join('、') || `条目 ${entry.uid ?? key}`;
                out.push({ id: `${name}::${entry.uid ?? key}`, book: name, title, content, disabled: Boolean(entry.disable) });
            }
        } catch (error) { /* 读不了的书跳过 */ }
    }
    return out;
}
