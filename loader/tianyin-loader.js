(function () {
    'use strict';

    // 酒馆助手脚本：从 GitHub 取 main 分支最新的 index.js 与 style.css 注入酒馆页面。
    // 本文件很少改，只有它变了才需要重新导入 json；程序本体更新后刷新页面即可。
    const REPOSITORY = 'Anyno001/mobile-ui-private';
    const BRANCH = 'main';
    const SHA_TTL = 10 * 60 * 1000;
    const CACHE_KEY = 'tianyin-loader';
    const LOADER_VERSION = '1.0.1';
    // 与 src/main.js 的启动标记一致：扩展版已启动时不再注入第二份。
    const BOOT_KEY = Symbol.for('tianyin-xiaojian.boot');

    const host = (() => {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (error) { /* 跨域 */ }
        return window;
    })();
    const doc = host.document;
    // 切换角色等会让酒馆助手重跑本脚本；上一次还在下载或已启动就不再重复。
    if (host.__tianyinLoader && host.__tianyinLoader.stage !== '失败') return;
    const status = { loader: LOADER_VERSION, stage: '正在读取版本', ref: '', attempts: [], error: '' };
    host.__tianyinLoader = status;

    function notify(kind, message) {
        const t = host.toastr || window.toastr;
        if (t && typeof t[kind] === 'function') t[kind](message, '天音小笺');
        else console.info(`[天音小笺] ${message}`);
    }

    // 扩展管理里装过本仓库（或上游）时，页面上已有它的脚本；新版扩展还会立启动标记。
    function extensionInstalled() {
        if (host[BOOT_KEY]) return true;
        return Array.from(doc.querySelectorAll('script[src]')).some(node => /\/extensions\/third-party\/(mobile-ui-private|sillytavern-phone-mode[^/]*)\/index\.js/i.test(node.src));
    }

    function readCache() {
        try { return JSON.parse(host.localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (error) { return {}; }
    }

    function writeCache(value) {
        try { host.localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch (error) { /* 存储不可用 */ }
    }

    async function get(url, ms) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        try {
            const res = await host.fetch(url, { cache: 'no-store', signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (error) {
            throw controller.signal.aborted ? new Error(`连接超时（${ms / 1000} 秒）`) : error;
        } finally {
            clearTimeout(timer);
        }
    }

    // 取 main 的最新提交号：按提交号取的 jsDelivr 文件不会被缓存成旧版。
    // 连不上 api.github.com 时用上次的提交号，再不行退回 @main（jsDelivr 可能滞后几小时）。
    async function latestRef() {
        const cached = readCache();
        if (cached.sha && Date.now() - cached.at < SHA_TTL) return cached.sha;
        try {
            const res = await get(`https://api.github.com/repos/${REPOSITORY}/git/ref/heads/${BRANCH}`, 6000);
            const sha = (await res.json())?.object?.sha;
            if (/^[0-9a-f]{40}$/.test(sha || '')) {
                writeCache({ sha, at: Date.now() });
                return sha;
            }
            throw new Error('返回内容里没有提交号');
        } catch (error) {
            status.attempts.push(`版本 api.github.com：${error.message}`);
            return cached.sha || BRANCH;
        }
    }

    async function fetchBundle(url) {
        const text = await (await get(url, 30000)).text();
        if (text.length < 10000 || text.trimStart().startsWith('<')) throw new Error('返回的不是天音小笺程序');
        return text;
    }

    function addStyle(href) {
        doc.getElementById('tianyin-loader-style')?.remove();
        const link = doc.createElement('link');
        link.id = 'tianyin-loader-style';
        link.rel = 'stylesheet';
        link.href = href;
        doc.head.appendChild(link);
    }

    // 别的脚本可能把酒馆页面的全局 URL 换掉，依次找一个还能生成 blob 地址的。
    function blobUrlApi() {
        return [host.URL, window.URL, host.webkitURL, window.webkitURL]
            .find(api => api && typeof api.createObjectURL === 'function' && typeof api.revokeObjectURL === 'function') || null;
    }

    // 与扩展一样以 module 方式在酒馆页面执行，而不是在酒馆助手的 iframe 里。
    function run(code, url) {
        const source = `${code}\n//# sourceURL=${url}`;
        const script = doc.createElement('script');
        script.type = 'module';
        const urlApi = blobUrlApi();
        const BlobCtor = typeof host.Blob === 'function' ? host.Blob : window.Blob;
        if (!urlApi || typeof BlobCtor !== 'function') {
            // 没有可用的 blob 地址时直接内联执行；内联脚本没有 load 事件，插入即视为已启动。
            status.attempts.push('blob 地址不可用，改为内联执行');
            script.textContent = source;
            doc.head.appendChild(script);
            return Promise.resolve();
        }
        const src = urlApi.createObjectURL(new BlobCtor([source], { type: 'text/javascript' }));
        return new Promise((resolve, reject) => {
            script.src = src;
            script.onload = () => { urlApi.revokeObjectURL(src); resolve(); };
            script.onerror = () => { urlApi.revokeObjectURL(src); reject(new Error('程序执行失败')); };
            doc.head.appendChild(script);
        });
    }

    async function main() {
        if (extensionInstalled()) {
            status.stage = '扩展版已在运行，跳过';
            return;
        }
        const ref = await latestRef();
        status.ref = ref;
        status.stage = `正在下载 ${ref.slice(0, 7)}`;
        const bust = ref === BRANCH ? `?t=${Math.floor(Date.now() / 60000)}` : '';
        // CSS 只能走 jsDelivr：raw.githubusercontent.com 返回 text/plain，浏览器不当样式表用。
        const sources = [
            { js: `https://cdn.jsdelivr.net/gh/${REPOSITORY}@${ref}/index.js${bust}`, css: `https://cdn.jsdelivr.net/gh/${REPOSITORY}@${ref}/style.css${bust}` },
            { js: `https://fastly.jsdelivr.net/gh/${REPOSITORY}@${ref}/index.js${bust}`, css: `https://fastly.jsdelivr.net/gh/${REPOSITORY}@${ref}/style.css${bust}` },
            { js: `https://raw.githubusercontent.com/${REPOSITORY}/${ref}/index.js?t=${Date.now()}`, css: `https://cdn.jsdelivr.net/gh/${REPOSITORY}@${ref}/style.css${bust}` },
        ];
        const errors = [];
        for (const source of sources) {
            const name = (source.js.match(/^https?:\/\/([^/]+)/) || [])[1] || source.js;
            let code;
            try {
                code = await fetchBundle(source.js);
            } catch (error) {
                errors.push(`${name}：${error.message}`);
                status.attempts.push(`${ref.slice(0, 7)} ${name}：${error.message}`);
                continue;
            }
            // 下载期间扩展版可能刚好启动完。
            if (extensionInstalled()) {
                status.stage = '扩展版已在运行，跳过';
                return;
            }
            status.stage = '正在启动';
            addStyle(source.css);
            await run(code, source.js);
            status.stage = '已就绪';
            status.attempts.push(`${ref.slice(0, 7)} ${name}：成功`);
            return;
        }
        status.stage = '失败';
        status.error = `天音小笺加载失败。${errors.join('；')}`;
        notify('error', status.error);
    }

    main().catch(error => {
        status.stage = '失败';
        status.error = `天音小笺加载失败：${error && error.message}`;
        notify('error', status.error);
    });
})();
