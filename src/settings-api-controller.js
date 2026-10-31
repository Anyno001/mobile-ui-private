import { API_ROUTE_MODULES, profileDisplayName, saveApiRoutes } from './api-routes.js';

export function createApiRequestController({ runtime, normalizeApiUrls, fetchWithCorsProxy, extractAiResponseContent, normalizeIndependentApiTemperature, defaultTemperature, apiDraftMode, clone, saveProfiles, addOrUpdateProfile, addNote, showApi, showModelPicker, escapeAttr, escapeHtml }) {
    const setStatus = (message, color) => {
        const status = document.getElementById('pm-api-status');
        if (status) { status.textContent = message; status.dataset.state = color; }
    };
    const readFailure = async response => {
        let detail = '';
        try {
            const raw = await response.text();
            if (raw) {
                try {
                    const data = JSON.parse(raw);
                    detail = data?.error?.message || data?.message || data?.error || '';
                } catch (error) { detail = raw; }
            }
        } catch (error) {
            // 错误响应体可能不可读；保留仅包含 HTTP 状态码的回退消息。
        }
        return `HTTP ${response.status}${detail ? `：${String(detail).trim().slice(0, 160)}` : ''}`;
    };
    const runAction = async (button, pendingLabel, operation) => {
        const controls = ['pm-api-fetch-models', 'pm-api-test-model']
            .map(id => document.getElementById(id)).filter(Boolean);
        if (controls.some(control => control.disabled)) return false;
        const originalLabel = button?.textContent || '';
        controls.forEach(control => { control.disabled = true; control.setAttribute?.('aria-busy', 'true'); });
        if (button) button.textContent = pendingLabel;
        try { return await operation(); } finally {
            controls.forEach(control => { control.disabled = false; control.removeAttribute?.('aria-busy'); });
            if (button?.isConnected !== false && originalLabel) button.textContent = originalLabel;
        }
    };
    // 正在编辑的预设 id；空串表示新建。打开页面时定位到与当前配置一致的那条。
    let editingId = '';
    const markEditing = () => {
        document.querySelectorAll('.pm-prof-li[data-profile-id]').forEach(row => row.classList.toggle('is-selected', row.dataset.profileId === editingId));
    };
    const fillForm = profile => {
        const field = id => document.getElementById(id);
        if (field('pm-cfg-name')) field('pm-cfg-name').value = profile?.name || '';
        if (field('pm-cfg-url')) field('pm-cfg-url').value = profile?.apiUrl || '';
        if (field('pm-cfg-key')) field('pm-cfg-key').value = profile?.apiKey || '';
        if (field('pm-cfg-model')) field('pm-cfg-model').value = profile?.model || '';
        if (field('pm-cfg-temperature')) field('pm-cfg-temperature').value = String(normalizeIndependentApiTemperature(profile?.temperature ?? defaultTemperature));
    };
    const deleteProfile = idx => {
        const profile = window.__pmProfiles[idx]; if (!profile) return false;
        const previous = clone(window.__pmProfiles), previousRoutes = clone(window.__pmApiRoutes || {});
        window.__pmProfiles.splice(idx, 1);
        // 指向该预设的模块改回跟随默认。
        for (const [module, route] of Object.entries(window.__pmApiRoutes || {})) if (route === profile.id) delete window.__pmApiRoutes[module];
        if (!saveProfiles() || !saveApiRoutes()) { window.__pmProfiles = previous; window.__pmApiRoutes = previousRoutes; alert('API档案删除失败：浏览器存储不可用。'); return false; }
        if (editingId === profile.id) editingId = '';
        showApi();
        return true;
    };
    const pickProfile = idx => {
        const profile = window.__pmProfiles[idx]; if (!profile) return;
        editingId = profile.id || '';
        fillForm(profile);
        markEditing();
        apiDraftMode.set(true);
    };
    // 新建预设：保留表单里正在用的地址、密钥、模型、温度，只清空名称并脱离正在编辑的预设，
    // 用户改个模型即可存成新预设。表单为空时回落到当前生效的配置。
    const newProfile = () => {
        const field = id => document.getElementById(id);
        const config = window.__pmConfig || {};
        const formValue = (id, fallback) => (field(id)?.value || '').trim() || fallback || '';
        const base = {
            apiUrl: formValue('pm-cfg-url', config.apiUrl),
            apiKey: formValue('pm-cfg-key', config.apiKey),
            model: formValue('pm-cfg-model', config.model),
            temperature: formValue('pm-cfg-temperature', config.temperature),
        };
        editingId = '';
        fillForm({ ...base, name: '' });
        markEditing();
        apiDraftMode.set(true);
        document.getElementById('pm-cfg-name')?.focus();
    };
    const setRoute = (module, value) => {
        const previous = clone(window.__pmApiRoutes || {});
        window.__pmApiRoutes = { ...previous };
        if (!value || value === 'default') delete window.__pmApiRoutes[module]; else window.__pmApiRoutes[module] = value;
        if (saveApiRoutes()) return true;
        window.__pmApiRoutes = previous; alert('模块分配保存失败：浏览器存储不可用。'); return false;
    };
    const setMode = value => apiDraftMode.set(value);
    const saveConfig = () => {
        const apiUrl = document.getElementById('pm-cfg-url')?.value.trim() ?? '', apiKey = document.getElementById('pm-cfg-key')?.value.trim() ?? '', model = document.getElementById('pm-cfg-model')?.value.trim() ?? '';
        const temperatureText = document.getElementById('pm-cfg-temperature')?.value.trim() ?? String(defaultTemperature);
        const parsedTemperature = Number(temperatureText), useIndependent = apiDraftMode.current();
        if (useIndependent && (!apiUrl || !apiKey || !model)) { setStatus('独立API必须填写地址、密钥和模型', 'error'); return false; }
        if (useIndependent && (!temperatureText || !Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2)) { setStatus('温度必须是 0 到 2 之间的数字', 'error'); return false; }
        const temperature = useIndependent ? parsedTemperature : normalizeIndependentApiTemperature(temperatureText);
        const previous = clone(window.__pmConfig), candidate = { apiUrl, apiKey, model, temperature, useIndependent };
        window.__pmConfig = candidate;
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(candidate)); }
        catch (error) { window.__pmConfig = previous; alert('API配置保存失败：浏览器存储不可用。'); return false; }
        const name = (document.getElementById('pm-cfg-name')?.value || '').trim().slice(0, 24);
        const savedId = !apiUrl || !apiKey ? true : addOrUpdateProfile({ ...(editingId ? { id: editingId } : {}), name, apiUrl, apiKey, model, temperature });
        if (typeof savedId === 'string') editingId = savedId;
        const profileSaved = savedId !== false;
        document.getElementById('pm-overlay')?.remove();
        addNote(profileSaved ? `已保存：${window.__pmConfig.useIndependent && apiUrl ? '独立API' : '主API'}` : 'API设置已保存；档案列表保存失败，不影响当前配置。');
        return true;
    };
    const getPageState = () => {
        const config = window.__pmConfig;
        const shortUrl = value => (value || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const profiles = window.__pmProfiles, routes = window.__pmApiRoutes || {};
        const current = profiles.find(item => item.apiUrl === config.apiUrl && item.apiKey === config.apiKey && (item.model || '') === (config.model || ''));
        editingId = current?.id || '';
        const option = (value, label, selected) => `<option value="${escapeAttr(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        return {
            cfg: {
                name: escapeAttr(current?.name || ''),
                apiUrl: escapeAttr(config.apiUrl || ''), apiKey: escapeAttr(config.apiKey || ''),
                model: escapeAttr(config.model || ''), temperature: escapeAttr(String(normalizeIndependentApiTemperature(config.temperature))),
            },
            useIndependent: apiDraftMode.current(),
            profilesHtml: profiles.length
                ? profiles.map((profile, index) => `<div class="pm-prof-li ${profile.id === editingId ? 'is-selected' : ''}" data-profile-id="${escapeAttr(profile.id || '')}"><div class="pm-prof-info" role="button" tabindex="0" onclick="window.__pmPickProfile(${index})"><div class="pm-prof-url">${escapeHtml(profileDisplayName(profile))}</div><div class="pm-prof-meta">${escapeHtml(shortUrl(profile.apiUrl))}${profile.model ? ' · ' + escapeHtml(profile.model) : ''}</div></div><button type="button" class="pm-prof-del" onclick="window.__pmDeleteProfile(${index})">删除</button></div>`).join('')
                : '<div class="pm-prof-empty">暂无预设，填写后保存即生成</div>',
            routesHtml: API_ROUTE_MODULES.map(({ key, label }) => {
                const route = routes[key] || 'default';
                const choices = [option('default', '跟随默认', route === 'default'), option('main', '酒馆主API', route === 'main'),
                    ...profiles.filter(item => item.id).map(item => option(item.id, profileDisplayName(item), route === item.id))];
                return `<label class="pm-api-route-row"><span>${escapeHtml(label)}</span><select class="pm-cfg-input" aria-label="${escapeAttr(label)}使用的API" onchange="window.__pmSetApiRoute('${key}',this.value)">${choices.join('')}</select></label>`;
            }).join(''),
        };
    };

    const testApi = async button => {
        const url = document.getElementById('pm-cfg-url')?.value.trim() || '';
        const key = document.getElementById('pm-cfg-key')?.value.trim() || '';
        if (!url || !key) { setStatus('请填写API地址和密钥', 'error'); return false; }
        return runAction(button, '拉取中…', async () => {
            setStatus('正在拉取模型…', 'info');
            const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
            try {
                const response = await fetchWithCorsProxy(normalizeApiUrls(url).modelsUrl, { method: 'GET', headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
                if (!response.ok) throw new Error(await readFailure(response));
                const data = await response.json();
                const models = Array.isArray(data?.data) ? [...new Set(data.data.map(item => typeof item?.id === 'string' ? item.id.trim() : '').filter(Boolean))] : [];
                if (!models.length) throw new Error('接口未返回可用模型');
                runtime.modelList = models;
                const input = document.getElementById('pm-cfg-model');
                if (input && !input.value.trim()) input.value = models[0];
                setStatus(`已拉取 ${models.length} 个模型`, 'success');
                return true;
            } catch (error) { setStatus(`拉取失败：${error.name === 'AbortError' ? '请求超时' : error.message}`, 'error'); return false; } finally { clearTimeout(timer); }
        });
    };
    const testModel = async button => {
        const url = document.getElementById('pm-cfg-url')?.value.trim() || '', key = document.getElementById('pm-cfg-key')?.value.trim() || '', model = document.getElementById('pm-cfg-model')?.value.trim() || '';
        if (!url || !key || !model) { setStatus('请填写完整的API地址、密钥与模型', 'error'); return false; }
        return runAction(button, '测试中…', async () => {
            setStatus(`正在测试「${model}」…`, 'info');
            const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
            try {
                const response = await fetchWithCorsProxy(normalizeApiUrls(url).chatUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: '只回复：OK' }] }), signal: controller.signal });
                if (!response.ok) throw new Error(await readFailure(response));
                const reply = extractAiResponseContent(await response.json());
                if (!reply) throw new Error('响应中没有可读取的文本');
                setStatus(`测试成功：“${reply.slice(0, 25)}”`, 'success'); return true;
            } catch (error) { setStatus(`测试失败：${error.name === 'AbortError' ? '请求超时' : error.message}`, 'error'); return false; } finally { clearTimeout(timer); }
        });
    };
    return { deleteProfile, pickProfile, newProfile, setRoute, setMode, saveConfig, getPageState, testApi, testModel, showModelPicker: () => showModelPicker(runtime) };
}
