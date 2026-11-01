// 剧情注入器在天音里的宿主层：酒馆上下文、本地文件、模型请求、通知、世界书。
// 参照 PlotInjector v0.1.18 src/host/，改成接天音的设施：请求走 callAI + API 按模块分配，不依赖酒馆助手。
import { isTianyinBackground, runTianyinBackground } from '../origin-host.js';
import { getCurrentChatWorldBooks } from '../worldbook-config.js';

// 注入器的三个用途对应天音「API 按模块分配」里的三个模块键。
export const PLOT_ROLE_MODULES = Object.freeze({ discuss: 'oracle', outline: 'plotSetting', check: 'plotCheck' });
const READ_TIMEOUT_MS = 20000;
const DEFAULT_TIMEOUT_MS = 180000;

function utf8Base64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

// 与 PlotInjector host/llm.js 一致：回复开头的 <think> 段去掉。
export function stripThinking(text) {
    return String(text || '').replace(/^\s*<(think|thinking)>[\s\S]*?<\/\1>\s*/i, '').trim();
}

// 注入器的消息数组拼成 callAI 的 system + user 两段。
export function flattenMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const system = list.filter(msg => msg.role === 'system').map(msg => msg.content).join('\n\n');
    const user = list.filter(msg => msg.role !== 'system').map(msg => `${msg.role === 'user' ? '用户' : 'AI'}：${msg.content}`).join('\n\n');
    return { system, user };
}

// 独立版剧情注入器（酒馆助手脚本）在同一页面运行时会挂 __plotInjector；它在就由它接管，天音不再起第二个运行时。
export function standalonePlotInjector(globalObject = globalThis) {
    try {
        const instance = globalObject?.__plotInjector;
        return instance && instance.runtime && instance.data ? instance : null;
    } catch (error) {
        return null;
    }
}

export function createPlotHost({ getCtx, callAI, fetchImpl, toastImpl } = {}) {
    const ctx = () => { try { return getCtx?.() || null; } catch (error) { return null; } };
    const request = (...args) => (fetchImpl || globalThis.fetch)(...args);
    const headers = () => {
        const c = ctx();
        if (!c || typeof c.getRequestHeaders !== 'function') throw new Error('酒馆连接尚未就绪');
        return { ...c.getRequestHeaders(), 'Content-Type': 'application/json' };
    };

    async function fetchWithTimeout(url, init) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
        try {
            return await request(url, { ...init, signal: controller.signal });
        } catch (error) {
            if (error && error.name === 'AbortError') throw new Error('读取超时，请检查网络');
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    const filePath = name => `user/files/${name}`;
    const files = {
        async read(name) {
            const res = await fetchWithTimeout(`/${filePath(name)}?t=${Date.now()}`, { cache: 'no-store' });
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`读取 ${name} 失败（HTTP ${res.status}）`);
            const text = await res.text();
            try {
                return { value: JSON.parse(text), bytes: new TextEncoder().encode(text).length };
            } catch (error) {
                throw new Error(`${name} 不是有效 JSON`);
            }
        },
        async write(name, value) {
            const text = JSON.stringify(value);
            const res = await request('/api/files/upload', { method: 'POST', headers: headers(), body: JSON.stringify({ name, data: utf8Base64(text) }) });
            if (!res.ok) throw new Error(`写入 ${name} 失败（HTTP ${res.status}）`);
            return new TextEncoder().encode(text).length;
        },
        async remove(name) {
            const res = await request('/api/files/delete', { method: 'POST', headers: headers(), body: JSON.stringify({ path: filePath(name) }) });
            if (res.status === 404) return false;
            if (!res.ok) throw new Error(`删除 ${name} 失败（HTTP ${res.status}）`);
            return true;
        },
    };

    // role 是注入器的用途（discuss/outline/check）；isolated 走 generateRaw，不带聊天上下文和世界书，也不触发生成事件。
    // signal 中止时以 AbortError 结束（剧情页的「停止」）。
    async function generate(role, messages, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
        if (typeof callAI !== 'function') throw new Error('天音的模型接口尚未就绪');
        const { system, user } = flattenMessages(messages);
        const controller = new AbortController();
        const forward = () => controller.abort(signal?.reason);
        if (signal?.aborted) forward();
        else signal?.addEventListener?.('abort', forward, { once: true });
        let timer = 0;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('请求超时')); }, timeoutMs);
        });
        const stopped = new Promise((_, reject) => {
            const fail = () => { const error = new Error('已停止'); error.name = 'AbortError'; reject(error); };
            if (controller.signal.aborted) fail();
            else controller.signal.addEventListener('abort', fail, { once: true });
        });
        try {
            const job = runTianyinBackground(() => callAI(system, user, { module: PLOT_ROLE_MODULES[role] || 'oracle', isolated: true, signal: controller.signal }));
            job.catch(() => {});
            const text = stripThinking(await Promise.race([job, timeout, stopped]));
            if (!text) throw new Error('模型没有返回内容');
            return text;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', forward);
        }
    }

    function toast(kind, message, title = '剧情注入器') {
        const t = toastImpl || globalThis.toastr;
        if (t && typeof t[kind] === 'function') t[kind](message, title);
        else console.info(`[剧情注入器] ${message}`);
    }

    function cardKey() {
        const c = ctx();
        if (!c) return '';
        if (c.groupId) return `group:${c.groupId}`;
        const card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
        return card && card.avatar ? `char:${card.avatar}` : '';
    }

    function cardName() {
        const c = ctx();
        if (!c) return '';
        if (c.groupId) return (Array.isArray(c.groups) && (c.groups.find(group => group.id === c.groupId) || {}).name) || '群聊';
        const card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
        return (card && card.name) || '';
    }

    // 兜底注入（酒馆没有条目加载事件时）：条目写进专用世界书，只在聊天未绑世界书时自动绑定。
    async function writeFallbackBook(name, wiEntries) {
        const c = ctx();
        if (!c || typeof c.saveWorldInfo !== 'function') throw new Error('当前酒馆不支持保存世界书');
        const book = { entries: {} };
        wiEntries.forEach((entry, index) => {
            const { world, ...rest } = entry;
            book.entries[index] = { ...rest, uid: index, displayIndex: index };
        });
        await c.saveWorldInfo(name, book, true);
        if (typeof c.updateWorldInfoList === 'function') await c.updateWorldInfoList();
        const meta = c.chatMetadata;
        if (meta && !meta.world_info) {
            meta.world_info = name;
            if (typeof c.saveMetadata === 'function') await c.saveMetadata();
            return { bound: true };
        }
        return { bound: Boolean(meta && meta.world_info === name), conflict: meta && meta.world_info && meta.world_info !== name ? meta.world_info : '' };
    }

    // 在当前卡绑定的世界书里按标题找条目（含已关闭的），返回正文；找不到返回空串。same 由调用方传入。只读，不写回。
    async function readEntryContent(title, same) {
        const c = ctx();
        if (!c || typeof c.loadWorldInfo !== 'function') return '';
        for (const { name } of getCurrentChatWorldBooks(c)) {
            try {
                const data = await c.loadWorldInfo(name);
                for (const entry of Object.values((data && data.entries) || {})) {
                    const content = String((entry && entry.content) || '').trim();
                    if (content && same(String(entry.comment || ''), title)) return content;
                }
            } catch (error) { /* 某本读不到就看下一本 */ }
        }
        return '';
    }

    return {
        ctx,
        cardKey,
        cardName,
        chatMessages: () => { const c = ctx(); return c && Array.isArray(c.chat) ? c.chat : []; },
        files,
        generate,
        toast,
        writeFallbackBook,
        readEntryContent,
        isBackground: isTianyinBackground,
        standalone: () => standalonePlotInjector(),
    };
}
