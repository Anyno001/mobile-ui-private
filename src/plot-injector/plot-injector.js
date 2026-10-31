// 剧情注入器在天音里的入口：启动时调一次 startPlotInjector，手机不打开也照常注入与检测。
// 同一页面装了独立版（酒馆助手脚本）时由独立版接管：getPlotApi() 返回独立版的数据层与运行时，界面操作的是同一份数据，
// 天音自己的运行时在各事件里直接返回（见 plot-runtime.js），不会一轮注入两次。
import { setYamlLib } from './core/yaml.js';
import { createPlotData } from './plot-data.js';
import { createPlotHost } from './plot-host.js';
import { createPlotRuntime } from './plot-runtime.js';

// 提示卡：界面打开时由界面订阅并渲染（带按钮）；没人订阅时退回 toast，只显示标题与说明。
// 带 timeout 的提示到时自动收起，计时器在 hide/destroy 时清除。
export function createPlotNotices({ toast }) {
    const items = new Map();
    const timers = new Map();
    const subscribers = new Set();
    // 订阅者返回 false 表示这次没显示出来（例如剧情页不在前台），由这里退回 toast。
    const notify = () => {
        let shown = false;
        for (const fn of subscribers) {
            try { if (fn([...items.values()]) !== false) shown = true; } catch (error) { console.error('[剧情注入器] 提示刷新失败', error); }
        }
        return shown;
    };
    const clearTimer = id => { if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); } };

    function hide(id) {
        clearTimer(id);
        if (items.delete(id)) notify();
    }

    return {
        show(item) {
            if (!item || !item.id) return;
            clearTimer(item.id);
            items.set(item.id, item);
            if (item.timeout) timers.set(item.id, setTimeout(() => hide(item.id), item.timeout));
            if (!notify()) toast('info', [item.title, item.body].filter(Boolean).join('：'));
        },
        hide,
        list: () => [...items.values()],
        subscribe(fn) {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        },
        destroy() {
            for (const id of [...timers.keys()]) clearTimer(id);
            items.clear();
            subscribers.clear();
        },
    };
}

export function startPlotInjector({ getCtx, callAI, fetchImpl, toastImpl, standaloneImpl } = {}) {
    const host = createPlotHost({ getCtx, callAI, fetchImpl, toastImpl });
    if (standaloneImpl) host.standalone = standaloneImpl;
    const yaml = globalThis.SillyTavern?.libs?.yaml;
    if (yaml) setYamlLib(yaml);
    else console.warn('[剧情注入器] 酒馆没有提供 YAML 解析库，大纲导入与 AI 写大纲不可用。');

    const listeners = new Set();
    const emit = reason => { for (const fn of listeners) { try { fn(reason); } catch (error) { console.error('[剧情注入器] 界面刷新失败', error); } } };
    const notice = createPlotNotices({ toast: host.toast });
    const data = createPlotData({
        host,
        onChange: reason => emit(reason),
        onError: error => host.toast('error', `保存失败，内容仍在内存里：${error.message}`),
    });
    let askReason = async reason => reason;
    const runtime = createPlotRuntime({ host, data, notice, emit, askReason: reason => askReason(reason) });

    let started = false;
    const ready = data.init().then(() => {
        runtime.start();
        started = true;
        emit('index');
    }).catch(error => {
        host.toast('error', `读取剧情注入器数据失败：${error.message}`);
    });

    // 界面统一从这里取数据层与运行时：独立版在就用独立版的，否则用天音自己的。
    function getPlotApi() {
        const standalone = host.standalone();
        if (standalone) return { owner: 'standalone', data: standalone.data, runtime: standalone.runtime, version: standalone.version || '' };
        return { owner: 'tianyin', data, runtime, version: '' };
    }

    return {
        ready,
        host,
        notice,
        getPlotApi,
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        setAskReason(fn) { askReason = typeof fn === 'function' ? fn : (async reason => reason); },
        // 页面挂起（关页、切后台）时立即写出防抖中的项目文件。
        flush: () => data.flush().catch(error => console.warn('[剧情注入器] 挂起前保存失败', error?.name || 'Error')),
        async destroy() {
            if (started) runtime.stop();
            notice.destroy();
            listeners.clear();
            await data.flush().catch(() => {});
        },
    };
}
