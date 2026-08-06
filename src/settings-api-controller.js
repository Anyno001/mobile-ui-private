export function createApiRequestController({ runtime, normalizeApiUrls, extractAiResponseContent, normalizeIndependentApiTemperature, defaultTemperature, apiDraftMode, clone, saveProfiles, addOrUpdateProfile, addNote, showApi, showModelPicker, escapeAttr, escapeHtml }) {
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
        } catch (error) {}
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
    const deleteProfile = idx => {
        const previous = clone(window.__pmProfiles);
        window.__pmProfiles.splice(idx, 1);
        if (!saveProfiles()) { window.__pmProfiles = previous; alert('API 档案删除失败：浏览器存储不可用。'); return false; }
        showApi();
        return true;
    };
    const pickProfile = idx => {
        const profile = window.__pmProfiles[idx]; if (!profile) return;
        const url = document.getElementById('pm-cfg-url'), key = document.getElementById('pm-cfg-key'), model = document.getElementById('pm-cfg-model');
        const temperature = document.getElementById('pm-cfg-temperature');
        if (url) url.value = profile.apiUrl || ''; if (key) key.value = profile.apiKey || ''; if (model) model.value = profile.model || '';
        if (temperature) temperature.value = String(normalizeIndependentApiTemperature(profile.temperature));
        apiDraftMode.set(true);
    };
    const setMode = value => apiDraftMode.set(value);
    const saveConfig = () => {
        const apiUrl = document.getElementById('pm-cfg-url')?.value.trim() ?? '', apiKey = document.getElementById('pm-cfg-key')?.value.trim() ?? '', model = document.getElementById('pm-cfg-model')?.value.trim() ?? '';
        const temperatureText = document.getElementById('pm-cfg-temperature')?.value.trim() ?? String(defaultTemperature);
        const parsedTemperature = Number(temperatureText), useIndependent = apiDraftMode.current();
        if (useIndependent && (!apiUrl || !apiKey || !model)) { setStatus('独立 API 必须填写地址、密钥和模型', 'error'); return false; }
        if (useIndependent && (!temperatureText || !Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2)) { setStatus('温度必须是 0 到 2 之间的数字', 'error'); return false; }
        const temperature = useIndependent ? parsedTemperature : normalizeIndependentApiTemperature(temperatureText);
        const previous = clone(window.__pmConfig), candidate = { apiUrl, apiKey, model, temperature, useIndependent };
        window.__pmConfig = candidate;
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(candidate)); }
        catch (error) { window.__pmConfig = previous; alert('API 配置保存失败：浏览器存储不可用。'); return false; }
        const profileSaved = !apiUrl || !apiKey || addOrUpdateProfile({ apiUrl, apiKey, model, temperature });
        document.getElementById('pm-overlay')?.remove();
        addNote(profileSaved ? `已保存：${window.__pmConfig.useIndependent && apiUrl ? '独立API' : '主API'}` : 'API 设置已保存；档案列表保存失败，不影响当前配置。');
        return true;
    };
    const getPageState = () => {
        const config = window.__pmConfig;
        const shortUrl = value => (value || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const maskKey = value => !value ? '' : (value.length <= 8 ? '****' : value.slice(0, 4) + '****' + value.slice(-4));
        return {
            cfg: {
                apiUrl: escapeAttr(config.apiUrl || ''), apiKey: escapeAttr(config.apiKey || ''),
                model: escapeAttr(config.model || ''), temperature: escapeAttr(String(normalizeIndependentApiTemperature(config.temperature))),
            },
            useIndependent: apiDraftMode.current(),
            profilesHtml: window.__pmProfiles.length
                ? window.__pmProfiles.map((profile, index) => `<div class="pm-prof-li"><div class="pm-prof-info" onclick="window.__pmPickProfile(${index})"><div class="pm-prof-url">${escapeHtml(shortUrl(profile.apiUrl))}</div><div class="pm-prof-meta">${escapeHtml(maskKey(profile.apiKey))}${profile.model ? ' · ' + escapeHtml(profile.model) : ''}</div></div><button type="button" class="pm-prof-del" onclick="window.__pmDeleteProfile(${index})">删除</button></div>`).join('')
                : '<div class="pm-prof-empty">暂无档案</div>',
        };
    };

    const testApi = async button => {
        const url = document.getElementById('pm-cfg-url')?.value.trim() || '';
        const key = document.getElementById('pm-cfg-key')?.value.trim() || '';
        if (!url || !key) { setStatus('请填写 API 地址和密钥', 'error'); return false; }
        return runAction(button, '拉取中…', async () => {
            setStatus('正在拉取模型…', 'info');
            const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
            try {
                const response = await fetch(normalizeApiUrls(url).modelsUrl, { method: 'GET', headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
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
        if (!url || !key || !model) { setStatus('请填写完整的 API 地址、密钥与模型', 'error'); return false; }
        return runAction(button, '测试中…', async () => {
            setStatus(`正在测试「${model}」…`, 'info');
            const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
            try {
                const response = await fetch(normalizeApiUrls(url).chatUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: '只回复：OK' }] }), signal: controller.signal });
                if (!response.ok) throw new Error(await readFailure(response));
                const reply = extractAiResponseContent(await response.json());
                if (!reply) throw new Error('响应中没有可读取的文本');
                setStatus(`测试成功：“${reply.slice(0, 25)}”`, 'success'); return true;
            } catch (error) { setStatus(`测试失败：${error.name === 'AbortError' ? '请求超时' : error.message}`, 'error'); return false; } finally { clearTimeout(timer); }
        });
    };
    return { deleteProfile, pickProfile, setMode, saveConfig, getPageState, testApi, testModel, showModelPicker: () => showModelPicker(runtime) };
}
