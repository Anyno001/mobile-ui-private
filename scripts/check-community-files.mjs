// 阻止的故障：清浏览器数据、换设备后社区与共享模板丢失；或用酒馆文件里的旧社区覆盖本地新内容、串到别的聊天。
// 影响：社区帖子、生成的提示词丢失或错乱。现有检查只覆盖 IndexedDB。
// 删除条件：放弃酒馆社区文件副本时随模块一起删除。
import assert from 'node:assert/strict';
import {
    COMMUNITY_FILE_STAMP_KEY, COMMUNITY_TEMPLATES_FILE, communityFileName, createCommunityFileSync,
    decideCommunitySync, readCommunityFile,
} from '../src/community-file-sync.js';

const memoryStorage = () => {
    const map = new Map();
    return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
};
const decodeUpload = body => JSON.parse(Buffer.from(JSON.parse(body).data, 'base64').toString('utf8'));
const scope = title => ({ scenes: { s1: { id: 's1', title } }, sceneOrder: ['s1'] });

function harness({ storageId = 'sms_a.png__聊天 1', store, files = {}, failRead = false } = {}) {
    const host = { storageId, store, files: { ...files }, uploads: [], timers: [] };
    let clock = 1000;
    const storage = memoryStorage();
    const sync = createCommunityFileSync({
        getCtx: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 't' }) }),
        getStorageId: () => host.storageId,
        getStore: () => host.store,
        commitStore: async replace => { host.store = replace(host.store); },
        fetchImpl: async (url, init = {}) => {
            if (url === '/api/files/upload') {
                const body = JSON.parse(init.body);
                host.uploads.push({ name: body.name, payload: decodeUpload(init.body), headers: init.headers });
                host.files[body.name] = decodeUpload(init.body);
                return { ok: true, status: 200 };
            }
            if (failRead) throw new Error('offline');
            const name = url.replace(/^\/user\/files\//, '').replace(/\?.*$/, '');
            if (!Object.hasOwn(host.files, name)) return { ok: false, status: 404 };
            return { ok: true, status: 200, json: async () => host.files[name] };
        },
        storage,
        now: () => clock,
        setTimer: callback => { host.timers.push(callback); return host.timers.length; },
        clearTimer: () => {},
    });
    const runTimers = async () => { const timers = host.timers.splice(0); for (const t of timers) await t(); };
    return { host, sync, storage, runTimers, tick: (v = 1) => { clock += v; return clock; } };
}

const sid = 'sms_a.png__聊天 1';
const fileName = communityFileName(sid);
assert.match(fileName, /^tianyin-community-[a-z0-9]{14}\.json$/, '文件名只用酒馆允许的字符');
assert.notEqual(communityFileName('sms_b.png__聊天 1'), fileName);
assert.equal(readCommunityFile({ version: 1, updatedAt: 5, storageId: 'other', scope: {} }, sid), null, '编号撞车也不串聊天');
assert.equal(decideCommunitySync({ remote: null, hasLocal: false }), 'none');
assert.equal(decideCommunitySync({ remote: { updatedAt: 9, data: {} }, hasLocal: true, localStamp: 5, localJson: 'x' }), 'adopt');

// 旧数据迁移：酒馆没有文件，本地有社区与模板 → 上传两个文件，带 CSRF 请求头，中文正常。
{
    const { host, sync } = harness({ store: { version: 3, scopes: { [sid]: scope('夜猫社区') }, sharedCommunityTemplates: [{ id: 't1' }] } });
    assert.equal(await sync.reconcile(), 'push/push');
    const names = host.uploads.map(item => item.name).sort();
    assert.deepEqual(names, [COMMUNITY_TEMPLATES_FILE, fileName].sort());
    assert.equal(host.files[fileName].scope.scenes.s1.title, '夜猫社区');
    assert.equal(host.files[fileName].storageId, sid);
    assert.equal(host.uploads[0].headers['X-CSRF-Token'], 't');
}

// 清过浏览器数据：本地空，从文件找回，不重新上传。
{
    const files = {
        [fileName]: { version: 1, updatedAt: 500, storageId: sid, scope: scope('找回') },
        [COMMUNITY_TEMPLATES_FILE]: { version: 1, updatedAt: 400, templates: [{ id: 't9' }] },
    };
    const { host, sync, storage } = harness({ store: { version: 3, scopes: {} }, files });
    assert.equal(await sync.reconcile(), 'adopt/adopt');
    assert.equal(host.store.scopes[sid].scenes.s1.title, '找回');
    assert.deepEqual(host.store.sharedCommunityTemplates, [{ id: 't9' }]);
    assert.equal(host.uploads.length, 0);
    assert.equal(JSON.parse(storage.getItem(COMMUNITY_FILE_STAMP_KEY))[sid], 500);
    assert.equal(sync.noteLocalChange(), false, '采用后的保存不算本地改动');
}

// 本地改动：防抖上传当前聊天那份；别的聊天的社区不上传。
{
    const { host, sync, runTimers, tick } = harness({ store: { version: 3, scopes: { [sid]: scope('一'), other: scope('别人') } } });
    await sync.reconcile();
    host.uploads.length = 0;
    host.store = { ...host.store, scopes: { ...host.store.scopes, other: scope('别人改了') } };
    assert.equal(sync.noteLocalChange(), false);
    tick();
    host.store = { ...host.store, scopes: { ...host.store.scopes, [sid]: scope('二') } };
    assert.equal(sync.noteLocalChange(), true);
    assert.equal(host.uploads.length, 0, '先防抖不立即上传');
    await runTimers();
    assert.equal(host.uploads.length, 1);
    assert.equal(host.uploads[0].payload.scope.scenes.s1.title, '二');
    assert.equal(host.uploads[0].payload.updatedAt, 1001);
    // flush：挂起时立即上传。
    host.store = { ...host.store, scopes: { ...host.store.scopes, [sid]: scope('三') } };
    assert.equal(sync.flush(), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(host.uploads.at(-1).payload.scope.scenes.s1.title, '三');
}

// 两边都有且不同：updatedAt 新的为准。
{
    const files = { [fileName]: { version: 1, updatedAt: 2000, storageId: sid, scope: scope('另一台设备') } };
    const { host, sync, storage } = harness({ store: { version: 3, scopes: { [sid]: scope('本机旧') } }, files });
    storage.setItem(COMMUNITY_FILE_STAMP_KEY, JSON.stringify({ [sid]: 900 }));
    await sync.reconcile();
    assert.equal(host.store.scopes[sid].scenes.s1.title, '另一台设备');
}
{
    const files = { [fileName]: { version: 1, updatedAt: 500, storageId: sid, scope: scope('文件旧') } };
    const { host, sync, storage } = harness({ store: { version: 3, scopes: { [sid]: scope('本机新') } }, files });
    storage.setItem(COMMUNITY_FILE_STAMP_KEY, JSON.stringify({ [sid]: 900 }));
    await sync.reconcile();
    assert.equal(host.store.scopes[sid].scenes.s1.title, '本机新');
    assert.equal(host.files[fileName].scope.scenes.s1.title, '本机新');
}

// 读文件失败（离线）：本次不动本地，也不上传。
{
    const { host, sync } = harness({ store: { version: 3, scopes: { [sid]: scope('本地') } }, failRead: true });
    assert.equal(await sync.reconcile(), 'skipped');
    assert.equal(host.store.scopes[sid].scenes.s1.title, '本地');
    assert.equal(host.uploads.length, 0);
}

// 文件内容不合规（提交队列校验失败）：沿用本地。
{
    const files = { [fileName]: { version: 1, updatedAt: 500, storageId: sid, scope: scope('坏') } };
    const { host, sync } = harness({ store: { version: 3, scopes: {} }, files });
    const original = host.store;
    const failing = createCommunityFileSync({
        getCtx: () => ({}), getStorageId: () => sid, getStore: () => host.store,
        commitStore: async () => { throw new Error('结构不合规'); },
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => files[fileName] }),
        storage: memoryStorage(), setTimer: () => 0, clearTimer: () => {},
    });
    await failing.reconcile();
    assert.equal(host.store, original);
    void sync;
}

console.log('Community file sync verified.');
