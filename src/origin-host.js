// 金手指宿主层（Origin 系统 原作 vicliaaa，经授权移植）：把 src/origin/ 的核心接到天音。
// 核心逐字拷自 IGS，只在 IGS 改；这里只提供 host（上下文、设置、存盘、生成、后台标记、通知），不绑酒馆事件、不注入、不剪数据块。
// 同一页面装了 IGS 时两边共用一个核心实例（Symbol.for('origin.engine')），数据只有 chatMetadata.origin_v2 一份。
import { getSharedOriginEngine } from './origin/origin-engine.js';
import { loadApiRoutes } from './api-routes.js';
import { loadOriginSettings } from './origin-settings.js';
import { loadProfiles } from './storage-preferences.js';

// 天音自己发起的后台请求计数：期间核心不注入、不记生成类型。所有经 callAI 的请求都包一层。
let backgroundCount = 0;
export const isTianyinBackground = () => backgroundCount > 0;
export async function runTianyinBackground(task) {
    backgroundCount += 1;
    try { return await task(); } finally { backgroundCount -= 1; }
}
export function trackBackgroundCalls(callAI) {
    return (...args) => runTianyinBackground(() => callAI(...args));
}

// 原版 Origin 扩展在页面里时会挂 #origin-root，且 extension_settings.origin 未关。
export function originLegacyActive(globalObject = globalThis) {
    try {
        const doc = globalObject?.document;
        if (!doc?.getElementById?.('origin-root')) return false;
        const ext = globalObject.extension_settings || globalObject.SillyTavern?.getContext?.()?.extensionSettings;
        return !ext || !ext.origin || ext.origin.enabled !== false;
    } catch (error) {
        return false;
    }
}

async function viaTavern(context, prompt) {
    if (!context) throw new Error('酒馆上下文不可用');
    // 与原插件一致优先 generateQuietPrompt；新版接受对象参数，旧版只认字符串。
    if (typeof context.generateQuietPrompt === 'function') {
        try { return String(await context.generateQuietPrompt({ quietPrompt: prompt }) || ''); }
        catch (error) { return String(await context.generateQuietPrompt(prompt) || ''); }
    }
    if (typeof context.generateRaw === 'function') return String(await context.generateRaw({ prompt }) || '');
    throw new Error('当前酒馆不支持后台生成');
}

// 「金手指」模块在 API 按模块分配里指定了路线时走 callAI；未指定时跟随酒馆当前连接。
function originRoute() {
    const routes = globalThis.window?.__pmApiRoutes || loadApiRoutes();
    const route = routes?.origin || '';
    if (route && route !== 'main' && !globalThis.window?.__pmProfiles?.length) loadProfiles();
    return route;
}

export function createOriginHost({ getCtx, callAI, readSettings = loadOriginSettings, legacyActive = originLegacyActive }) {
    const ctx = () => { try { return getCtx() || null; } catch (error) { return null; } };
    let noticeSink = null;
    return {
        getContext: ctx,
        settings: () => readSettings(),
        saveMetadata: () => {
            const c = ctx();
            const save = c && (c.saveMetadataDebounced || c.saveMetadata);
            if (typeof save === 'function') save.call(c);
        },
        generate: (kind, prompt) => runTianyinBackground(() => (originRoute() && typeof callAI === 'function'
            ? callAI('', prompt, { module: 'origin' }).then(text => String(text || ''))
            : viaTavern(ctx(), prompt))),
        isBackground: isTianyinBackground,
        notify: ({ kind, text } = {}) => {
            if (!text || typeof noticeSink !== 'function') return;
            try { noticeSink({ kind: String(kind || 'info'), text: String(text) }); } catch (error) { /* 提示出错不影响结算 */ }
        },
        legacyActive: () => { try { return Boolean(legacyActive()); } catch (error) { return false; } },
        setNoticeSink: fn => { noticeSink = typeof fn === 'function' ? fn : null; },
    };
}

// 启动时调一次：登记 host 并按总开关挂/卸监听。设置变化后调 sync()；release() 撤下本方 host。
export function startOriginHost(options) {
    const host = createOriginHost(options);
    const engine = getSharedOriginEngine(host);
    engine.sync();
    return {
        host, engine,
        sync: () => engine.sync(),
        setNoticeSink: host.setNoticeSink,
        release: () => { try { engine.release(); } catch (error) { /* 已撤下 */ } },
    };
}
