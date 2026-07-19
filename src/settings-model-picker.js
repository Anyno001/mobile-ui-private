import { MODEL_VISIBLE_ROWS, POPOVER_SUPPORTED } from './constants.js';
import { escapeAttr, escapeHtml } from './ui.js';

export function showModelPicker(runtime) {
    const existing = document.getElementById('pm-model-dropdown');
    if (existing) {
        if (typeof existing.__pmCloseDropdown === 'function') existing.__pmCloseDropdown();
        else existing.remove();
        return;
    }
    if (!runtime.modelList.length) {
        const status = document.getElementById('pm-api-status');
        if (status) {
            status.textContent = '请先拉取模型';
            status.style.color = '#ff9500';
        }
        return;
    }
    const input = document.getElementById('pm-cfg-model');
    const rect = input.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.id = 'pm-model-dropdown';
    dropdown.className = 'pm-model-dropdown';
    dropdown.dataset.theme = window.__pmTheme?.darkMode || 'light';
    dropdown.style.setProperty('--pm-model-visible-rows', String(MODEL_VISIBLE_ROWS));
    if (POPOVER_SUPPORTED) dropdown.setAttribute('popover', 'manual');
    dropdown.innerHTML = `<input class="pm-model-search" aria-label="搜索模型" placeholder="🔍 搜索..." /><div class="pm-model-options"></div>`;
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.width = rect.width + 'px';
    document.body.appendChild(dropdown);
    if (dropdown.showPopover) try { dropdown.showPopover(); } catch (error) {}

    let closer = null;
    let closed = false;
    const closeDropdown = () => {
        if (closed) return false;
        closed = true;
        dropdown.remove();
        if (closer) document.removeEventListener('click', closer, true);
        return true;
    };
    dropdown.__pmCloseDropdown = closeDropdown;

    const options = dropdown.querySelector('.pm-model-options');
    const render = (filter = '') => {
        const normalizedFilter = filter.toLowerCase();
        const filtered = runtime.modelList.filter(model => !normalizedFilter || model.toLowerCase().includes(normalizedFilter));
        const current = document.getElementById('pm-cfg-model')?.value || '';
        options.innerHTML = filtered.length
            ? filtered.map(model => `<button type="button" class="pm-model-opt" data-m="${escapeAttr(model)}" aria-pressed="${model === current}">${escapeHtml(model)}</button>`).join('')
            : '<div class="pm-model-empty">无匹配</div>';
        options.querySelectorAll('.pm-model-opt').forEach(option => option.addEventListener('click', () => {
            document.getElementById('pm-cfg-model').value = option.dataset.m;
            closeDropdown();
        }));
    };
    render();
    const search = dropdown.querySelector('.pm-model-search');
    search.addEventListener('input', function () { render(this.value); });
    search.focus();
    setTimeout(() => {
        if (closed) return;
        closer = event => {
            if (!dropdown.contains(event.target) && event.target.id !== 'pm-model-arrow') closeDropdown();
        };
        document.addEventListener('click', closer, true);
    }, 0);
}
