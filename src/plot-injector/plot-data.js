// 参照 PlotInjector v0.1.15 src/app/data.js 与 src/host/files.js 的防抖写入；文件读写、卡片键改由宿主层传入。
// 数据层：索引常驻内存；项目、讨论按需读。读出的对象共享只读，改动一律浅拷后整体替换。
// 文件与独立版相同（user/files/pi-index.json、pi-p-<id>.json、pi-c-<id>.json），两边可互读。
import { INDEX_FILE, chatFile, emptyChat, emptyIndex, newProject, normalizeChat, normalizeIndex, normalizeProject, normalizeSettings, projectFile } from './core/store.js';

const WRITE_DELAY_MS = 800;

// 防抖写入：同一文件 800ms 内只写最后一版；失败保留待写内容并回调，不静默丢。计时器在 flush() 时清除。
function createWriter({ write, onError, onSaved }) {
    const pending = new Map();
    const timers = new Map();

    async function flushOne(name) {
        timers.delete(name);
        if (!pending.has(name)) return;
        const value = pending.get(name);
        pending.delete(name);
        try {
            onSaved(name, await write(name, value));
        } catch (error) {
            if (!pending.has(name)) pending.set(name, value);
            onError(name, error);
        }
    }

    return {
        schedule(name, value) {
            pending.set(name, value);
            if (timers.has(name)) clearTimeout(timers.get(name));
            timers.set(name, setTimeout(() => flushOne(name), WRITE_DELAY_MS));
        },
        async flush() {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
            await Promise.all([...pending.keys()].map(flushOne));
        },
        cancel(name) {
            if (timers.has(name)) clearTimeout(timers.get(name));
            timers.delete(name);
            pending.delete(name);
        },
    };
}

export function createPlotData({ host, onChange = () => {}, onError = () => {} }) {
    const { files, cardKey } = host;
    let index = emptyIndex();
    let ready = false;
    const projects = new Map();
    const chats = new Map();
    const loading = new Map();
    const failed = new Set();

    const writer = createWriter({
        write: files.write,
        onSaved(name, bytes) {
            failed.delete(name);
            if (name === INDEX_FILE) return;
            const id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1];
            const meta = index.projects.find(item => item.id === id);
            const kind = name.startsWith('pi-p-') ? 'project' : 'chat';
            const knownFile = index.files.includes(name);
            if (meta && meta.bytes[kind] !== bytes) {
                index = { ...index, projects: index.projects.map(item => (item === meta ? { ...item, bytes: { ...item.bytes, [kind]: bytes } } : item)) };
            }
            if (!knownFile) index = { ...index, files: [...index.files, name] };
            if (!knownFile || (meta && meta.bytes[kind] !== bytes)) writer.schedule(INDEX_FILE, index);
            onChange('saved');
        },
        onError(name, error) {
            failed.add(name);
            onError(error);
            onChange('save-failed');
        },
    });

    function setIndex(next) {
        index = next;
        writer.schedule(INDEX_FILE, index);
        onChange('index');
    }

    async function init() {
        const file = await files.read(INDEX_FILE);
        index = normalizeIndex(file && file.value);
        if (!index.files.includes(INDEX_FILE)) index = { ...index, files: [INDEX_FILE, ...index.files] };
        ready = true;
        onChange('index');
    }

    async function loadProject(id) {
        if (projects.has(id)) return projects.get(id);
        if (loading.has(`p:${id}`)) return loading.get(`p:${id}`);
        const job = (async () => {
            const file = await files.read(projectFile(id));
            const project = file ? normalizeProject(file.value, id) : null;
            if (project) projects.set(id, project);
            return project;
        })().finally(() => loading.delete(`p:${id}`));
        loading.set(`p:${id}`, job);
        return job;
    }

    function touch(id, patch = {}) {
        setIndex({ ...index, projects: index.projects.map(item => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)) });
    }

    function saveProject(project) {
        projects.set(project.id, project);
        writer.schedule(projectFile(project.id), project);
        touch(project.id, { name: project.name });
        onChange('project', project.id);
    }

    function updateProject(id, fn) {
        const current = projects.get(id);
        if (!current) throw new Error('项目尚未载入');
        const next = fn(current);
        if (next && next !== current) saveProject(next);
        return next;
    }

    async function createProject(name, group = '') {
        const project = newProject(name);
        projects.set(project.id, project);
        const bytes = await files.write(projectFile(project.id), project);
        index = {
            ...index,
            projects: [...index.projects, { id: project.id, name: project.name, group, updatedAt: Date.now(), bytes: { project: bytes } }],
            files: index.files.includes(projectFile(project.id)) ? index.files : [...index.files, projectFile(project.id)],
        };
        writer.schedule(INDEX_FILE, index);
        onChange('index');
        return project;
    }

    async function deleteProject(id) {
        writer.cancel(projectFile(id));
        writer.cancel(chatFile(id));
        await files.remove(projectFile(id));
        await files.remove(chatFile(id));
        projects.delete(id);
        chats.delete(id);
        const active = { ...index.active };
        for (const key of Object.keys(active)) if (active[key] === id) delete active[key];
        setIndex({
            ...index,
            active,
            projects: index.projects.filter(item => item.id !== id),
            files: index.files.filter(name => name !== projectFile(id) && name !== chatFile(id)),
        });
    }

    async function loadChat(id) {
        if (chats.has(id)) return chats.get(id);
        const file = await files.read(chatFile(id));
        const chat = normalizeChat(file && file.value);
        chats.set(id, chat);
        return chat;
    }

    function saveChat(id, chat) {
        chats.set(id, chat);
        writer.schedule(chatFile(id), chat);
        onChange('chat', id);
    }

    async function clearChat(id) {
        writer.cancel(chatFile(id));
        await files.remove(chatFile(id));
        chats.set(id, emptyChat());
        const meta = index.projects.find(item => item.id === id);
        setIndex({
            ...index,
            files: index.files.filter(name => name !== chatFile(id)),
            projects: index.projects.map(item => (item === meta ? { ...item, bytes: { ...item.bytes, chat: 0 } } : item)),
        });
    }

    function activeIdFor(key = cardKey()) {
        const id = key ? index.active[key] : '';
        return id && index.projects.some(item => item.id === id) ? id : '';
    }

    function setActive(id, key = cardKey()) {
        if (!key) throw new Error('请先打开一张角色卡');
        const active = { ...index.active };
        if (id) active[key] = id;
        else delete active[key];
        setIndex({ ...index, active });
        if (id) touch(id);
    }

    return {
        init,
        isReady: () => ready,
        index: () => index,
        settings: () => index.settings,
        project: id => projects.get(id) || null,
        loadProject,
        saveProject,
        updateProject,
        createProject,
        deleteProject,
        renameProject: (id, name, group) => {
            const project = projects.get(id);
            if (project && name && project.name !== name) saveProject({ ...project, name });
            touch(id, { ...(name ? { name } : {}), ...(group !== undefined ? { group } : {}) });
        },
        loadChat,
        chat: id => chats.get(id) || null,
        saveChat,
        clearChat,
        activeIdFor,
        setActive,
        updateSettings: patch => setIndex({ ...index, settings: normalizeSettings({ ...index.settings, ...patch }) }),
        failedFiles: () => [...failed],
        flush: () => writer.flush(),
    };
}
