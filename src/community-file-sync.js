/**
 * 社区存酒馆文件（user/files/），不进聊天记录：
 * - 每个聊天的社区一个文件 tianyin-community-<编号>.json；共享模板一个文件 tianyin-community-templates.json。
 * - 浏览器 IndexedDB 仍是主存储；社区保存成功后防抖上传当前聊天的那份。
 * - 打开手机、切换聊天、启动时对账：两边都有且不同，updatedAt 新的整份为准。
 * - 防抖计时器由本模块持有，flush/dispose 释放；页面挂起时 flush 立即上传。
 */
export const COMMUNITY_FILE_VERSION = 1;
export const COMMUNITY_FILE_PREFIX = 'tianyin-community-';
export const COMMUNITY_TEMPLATES_FILE = 'tianyin-community-templates.json';
export const COMMUNITY_FILE_STAMP_KEY = 'ST_SMS_COMMUNITY_FILE_STAMPS_V1';
export const TEMPLATES_STAMP_ID = '__templates__';
const UPLOAD_DELAY_MS = 1500;
const STAMP_LIMIT = 500;

const plainRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validStorageId = id => typeof id === 'string' && Boolean(id) && id !== 'sms_unknown__default';

function hash32(text, seed) {
    let hash = seed >>> 0;
    for (const char of String(text)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).padStart(7, '0');
}

/** 文件名只能用字母数字 _ - .：storageId 含中文与空格，取两段哈希作编号；文件里另存 storageId 核对。 */
export function communityFileName(storageId) {
    return `${COMMUNITY_FILE_PREFIX}${hash32(storageId, 2166136261)}${hash32(storageId, 374761393)}.json`;
}

export function scopeHasContent(scope) {
    if (!plainRecord(scope)) return false;
    return Object.keys(plainRecord(scope.scenes) ? scope.scenes : {}).length > 0
        || Object.keys(plainRecord(scope.liveRooms) ? scope.liveRooms : {}).length > 0;
}

export function readCommunityFile(raw, storageId = null) {
    if (!plainRecord(raw) || raw.version !== COMMUNITY_FILE_VERSION || !Number.isFinite(raw.updatedAt)) return null;
    if (storageId !== null) {
        if (raw.storageId !== storageId || !plainRecord(raw.scope)) return null;
        return { updatedAt: raw.updatedAt, data: raw.scope };
    }
    return Array.isArray(raw.templates) ? { updatedAt: raw.updatedAt, data: raw.templates } : null;
}

/** 与聊天元数据同一规则：none 不动 / push 上传本地 / adopt 用文件覆盖本地 / same 相同。 */
export function decideCommunitySync({ remote, hasLocal, localStamp, localJson }) {
    if (!remote) return hasLocal ? 'push' : 'none';
    if (!hasLocal) return 'adopt';
    if (JSON.stringify(remote.data) === localJson) return 'same';
    return localStamp > remote.updatedAt ? 'push' : 'adopt';
}

function utf8Base64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
}

export function createCommunityFileSync({
    getCtx, getStorageId, getStore, loadStore = getStore, commitStore,
    fetchImpl = (...args) => globalThis.fetch(...args), storage = globalThis.localStorage, now = Date.now,
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer),
}) {
    // 对账后的基线：当前聊天的社区与共享模板的 JSON；保存后与之比较判断是否有本地改动。
    let baseline = null;
    let uploadTimer = null;
    // 在当前聊天里改动了别的聊天的社区（全局固定）：这些聊天的社区 JSON 基线，保存后有变化就同样记时间并上传。
    const foreignBaselines = new Map();
    let foreignEpoch = 0;
    const pendingUploads = new Map();

    const readStamps = () => {
        try {
            const parsed = JSON.parse(storage?.getItem(COMMUNITY_FILE_STAMP_KEY) || '{}');
            return plainRecord(parsed) ? parsed : {};
        } catch (error) { return {}; }
    };
    const localStamp = id => (Number.isFinite(readStamps()[id]) ? readStamps()[id] : 0);
    const writeStamp = (ids, value) => {
        const stamps = readStamps();
        for (const id of ids) if (id) stamps[id] = value;
        const entries = Object.entries(stamps).filter(([, stamp]) => Number.isFinite(stamp))
            .sort((a, b) => b[1] - a[1]).slice(0, STAMP_LIMIT);
        try { storage?.setItem(COMMUNITY_FILE_STAMP_KEY, JSON.stringify(Object.fromEntries(entries))); }
        catch (error) { console.warn('[phone-mode] 社区文件时间戳保存失败', error?.name || 'Error'); }
    };
    const headers = () => {
        const context = getCtx();
        return typeof context?.getRequestHeaders === 'function'
            ? context.getRequestHeaders() : { 'Content-Type': 'application/json' };
    };

    const localScopeJson = (store, storageId) => JSON.stringify(store?.scopes?.[storageId] ?? null);
    const localTemplatesJson = store => JSON.stringify(store?.sharedCommunityTemplates || []);

    async function readRemote(fileName, storageId = null) {
        let response;
        try {
            response = await fetchImpl(`/user/files/${fileName}?t=${now()}`, { cache: 'no-store' });
        } catch (error) { throw new Error(`读取酒馆社区文件失败：${error?.message || '网络不通'}`); }
        if (response?.status === 404) return null;
        if (!response?.ok) throw new Error(`读取酒馆社区文件失败：HTTP ${response?.status ?? '无响应'}`);
        try { return readCommunityFile(await response.json(), storageId); }
        catch (error) { return null; }
    }

    async function upload(fileName, payload, { keepalive = false } = {}) {
        const response = await fetchImpl('/api/files/upload', {
            method: 'POST', headers: headers(), keepalive,
            body: JSON.stringify({ name: fileName, data: utf8Base64(JSON.stringify(payload)) }),
        });
        if (!response?.ok) throw new Error(`上传社区文件失败：HTTP ${response?.status ?? '无响应'}`);
        return true;
    }

    const payloadFor = (key, store, updatedAt) => (key === TEMPLATES_STAMP_ID
        ? { version: COMMUNITY_FILE_VERSION, updatedAt, templates: store?.sharedCommunityTemplates || [] }
        : { version: COMMUNITY_FILE_VERSION, updatedAt, storageId: key, scope: store?.scopes?.[key] ?? {} });
    const fileNameFor = key => (key === TEMPLATES_STAMP_ID ? COMMUNITY_TEMPLATES_FILE : communityFileName(key));

    async function runUploads({ keepalive = false } = {}) {
        if (uploadTimer !== null) { clearTimer(uploadTimer); uploadTimer = null; }
        const store = getStore();
        const jobs = [...pendingUploads.entries()];
        pendingUploads.clear();
        await Promise.all(jobs.map(async ([key, updatedAt]) => {
            try { await upload(fileNameFor(key), payloadFor(key, store, updatedAt), { keepalive }); }
            catch (error) {
                // 失败的留到下次改动或对账时重试，不自建重试循环。
                if (!pendingUploads.has(key)) pendingUploads.set(key, updatedAt);
                console.warn('[phone-mode] 社区文件上传失败', error?.message || error?.name || 'Error');
            }
        }));
    }
    const scheduleUpload = (key, updatedAt) => {
        pendingUploads.set(key, updatedAt);
        if (uploadTimer !== null) clearTimer(uploadTimer);
        uploadTimer = setTimer(() => { uploadTimer = null; void runUploads(); }, UPLOAD_DELAY_MS);
    };

    /** 社区保存成功后调用：当前聊天的社区或共享模板有变化就记时间并排队上传。 */
    const noteForeignChanges = store => {
        let changed = false;
        for (const [foreignId, foreignJson] of foreignBaselines) {
            const json = localScopeJson(store, foreignId);
            if (json === foreignJson) continue;
            const updatedAt = now();
            writeStamp([foreignId], updatedAt);
            scheduleUpload(foreignId, updatedAt);
            foreignBaselines.set(foreignId, json);
            changed = true;
        }
        return changed;
    };

    const noteLocalChange = () => {
        const storageId = getStorageId();
        const store = getStore();
        if (!store) return false;
        const foreignChanged = noteForeignChanges(store);
        if (!baseline || baseline.storageId !== storageId) return foreignChanged;
        const scopeJson = localScopeJson(store, storageId);
        const templatesJson = localTemplatesJson(store);
        const updatedAt = now();
        let changed = false;
        if (scopeJson !== baseline.scopeJson) {
            writeStamp([storageId], updatedAt);
            scheduleUpload(storageId, updatedAt);
            changed = true;
        }
        if (templatesJson !== baseline.templatesJson) {
            writeStamp([TEMPLATES_STAMP_ID], updatedAt);
            scheduleUpload(TEMPLATES_STAMP_ID, updatedAt);
            changed = true;
        }
        baseline = { storageId, scopeJson, templatesJson };
        return changed || foreignChanged;
    };

    /** 关闭手机、页面挂起时立即上传排队中的改动。 */
    const flush = () => {
        noteLocalChange();
        if (!pendingUploads.size) return false;
        void runUploads({ keepalive: true });
        return true;
    };

    const dispose = () => {
        if (uploadTimer !== null) clearTimer(uploadTimer);
        uploadTimer = null;
    };

    /** 备份导入后这些聊天的社区以本地为准。 */
    const markLocalAuthoritative = storageIds => writeStamp([...storageIds, TEMPLATES_STAMP_ID], now());

    async function reconcileOne(key, store) {
        const isTemplates = key === TEMPLATES_STAMP_ID;
        const remote = await readRemote(fileNameFor(key), isTemplates ? null : key);
        const localJson = isTemplates ? localTemplatesJson(store) : localScopeJson(store, key);
        const hasLocal = isTemplates
            ? (store?.sharedCommunityTemplates || []).length > 0 : scopeHasContent(store?.scopes?.[key]);
        const stamp = localStamp(key);
        const action = decideCommunitySync({ remote, hasLocal, localStamp: stamp, localJson });
        if (action === 'push') {
            const updatedAt = stamp || now();
            writeStamp([key], updatedAt);
            pendingUploads.set(key, updatedAt);
        }
        return { action, remote };
    }

    /** 对账当前聊天的社区与共享模板；读文件失败时本次不动本地。 */
    const reconcile = async () => {
        const storageId = getStorageId();
        baseline = null;
        foreignBaselines.clear();
        foreignEpoch += 1;
        if (!validStorageId(storageId)) return 'skipped';
        const store = await Promise.resolve(loadStore()).catch(() => null);
        if (!store) return 'skipped';
        let scopeResult, templatesResult;
        try {
            [scopeResult, templatesResult] = await Promise.all([
                reconcileOne(storageId, store), reconcileOne(TEMPLATES_STAMP_ID, store),
            ]);
        } catch (error) {
            console.warn('[phone-mode] 社区文件对账失败，本次沿用本地', error?.message || error?.name || 'Error');
            return 'skipped';
        }
        if (getStorageId() !== storageId) return 'skipped';
        const adoptScope = scopeResult.action === 'adopt';
        const adoptTemplates = templatesResult.action === 'adopt';
        if (adoptScope || adoptTemplates) {
            try {
                // 经社区提交队列写入：会走结构校验，文件内容不合规时整次不采用。
                await commitStore(current => {
                    const next = { ...current, scopes: { ...current.scopes } };
                    if (adoptScope) next.scopes[storageId] = scopeResult.remote.data;
                    if (adoptTemplates) {
                        if (templatesResult.remote.data.length) next.sharedCommunityTemplates = templatesResult.remote.data;
                        else delete next.sharedCommunityTemplates;
                    }
                    return next;
                });
                if (adoptScope) writeStamp([storageId], scopeResult.remote.updatedAt);
                if (adoptTemplates) writeStamp([TEMPLATES_STAMP_ID], templatesResult.remote.updatedAt);
            } catch (error) {
                console.warn('[phone-mode] 酒馆社区文件无法采用，沿用本地', error?.message || error?.name || 'Error');
            }
        }
        const latest = getStore();
        baseline = { storageId, scopeJson: localScopeJson(latest, storageId), templatesJson: localTemplatesJson(latest) };
        if (pendingUploads.size) await runUploads();
        return `${scopeResult.action}/${templatesResult.action}`;
    };

    /**
     * 要在当前聊天里改别的聊天的社区（打开它固定的社区）前调用：先按同一规则对账那个聊天的文件（文件更新就先采用，不会拿旧数据盖掉），
     * 再登记基线；之后的改动会写时间戳并排队上传，回到那个聊天时本地更新、不会被旧文件覆盖。
     */
    async function reconcileForeign(foreignId) {
        if (!validStorageId(foreignId) || foreignId === getStorageId()) return 'skipped';
        foreignBaselines.delete(foreignId);
        const epoch = ++foreignEpoch;
        const store = await Promise.resolve(loadStore()).catch(() => null);
        if (!store) return 'skipped';
        let result;
        try { result = await reconcileOne(foreignId, store); }
        catch (error) {
            console.warn('[phone-mode] 社区文件对账失败，本次沿用本地', error?.message || error?.name || 'Error');
            return 'skipped';
        }
        let trusted = result.action !== 'adopt';
        if (result.action === 'adopt') {
            try {
                await commitStore(current => ({ ...current, scopes: { ...current.scopes, [foreignId]: result.remote.data } }));
                writeStamp([foreignId], result.remote.updatedAt);
                trusted = true;
            } catch (error) {
                console.warn('[phone-mode] 酒馆社区文件无法采用，沿用本地', error?.message || error?.name || 'Error');
            }
        }
        // 读文件失败或采用失败时不登记：之后改动不会带新时间戳去覆盖另一台设备的新文件；等待期间已切聊天（reconcile 已清空）也不登记。
        if (trusted && epoch === foreignEpoch) foreignBaselines.set(foreignId, localScopeJson(getStore(), foreignId));
        if (pendingUploads.size) void runUploads();
        return result.action;
    }

    return { reconcile, reconcileForeign, noteLocalChange, flush, dispose, markLocalAuthoritative };
}
