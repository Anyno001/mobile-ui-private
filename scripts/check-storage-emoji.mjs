import assert from 'node:assert/strict';

const EMOJI_KEY = 'ST_SMS_EMOJIS';
const FALLBACK_KEY = `${EMOJI_KEY}_LOCAL_FALLBACK`;
const idbValues = new Map();
const idbControl = {
    failNextGet: false,
    failNextPut: false,
};

globalThis.indexedDB = {
    open() {
        const request = {};
        queueMicrotask(() => {
            const db = {
                objectStoreNames: { contains: () => true },
                transaction() {
                    const transaction = {};
                    transaction.objectStore = () => ({
                        get(key) {
                            const getRequest = {};
                            queueMicrotask(() => {
                                if (idbControl.failNextGet) {
                                    idbControl.failNextGet = false;
                                    getRequest.onerror?.();
                                    return;
                                }
                                getRequest.result = idbValues.get(key);
                                getRequest.onsuccess?.();
                            });
                            return getRequest;
                        },
                        put(value, key) {
                            queueMicrotask(() => {
                                if (idbControl.failNextPut) {
                                    idbControl.failNextPut = false;
                                    transaction.onerror?.();
                                    return;
                                }
                                idbValues.set(key, structuredClone(value));
                                transaction.oncomplete?.();
                            });
                        },
                    });
                    return transaction;
                },
                close() {},
            };
            request.result = db;
            request.onsuccess?.();
        });
        return request;
    },
};

const warnings = [];
console.warn = (...args) => warnings.push(args);
globalThis.window = { __pmEmojis: [] };
const { loadEmojis, saveEmojis } = await import('../src/storage.js');

idbValues.set(EMOJI_KEY, [{ id: 'primary', name: '主存储', images: [] }]);
globalThis.localStorage = {
    getItem: key => key === FALLBACK_KEY ? JSON.stringify([{ id: 'stale', name: '旧后备', images: [] }]) : null,
    setItem() { throw new Error('fallback write denied'); },
    removeItem() { throw new Error('fallback delete denied'); },
};
await loadEmojis();
assert.equal(window.__pmEmojis[0].id, 'primary', '有效主存储必须优先于无法删除的旧 fallback');
window.__pmEmojis = [{ id: 'saved', name: '新值', images: [] }];
await saveEmojis();
assert.equal(idbValues.get(EMOJI_KEY)[0].id, 'saved', '主存储成功后 fallback 清理失败不得造成保存失败');

idbValues.delete(EMOJI_KEY);
globalThis.localStorage = {
    getItem: key => key === FALLBACK_KEY ? JSON.stringify([{ id: 'fallback', name: '后备', images: [] }]) : null,
    setItem() {},
    removeItem() {},
};
await loadEmojis();
assert.equal(window.__pmEmojis[0].id, 'fallback', '主存储缺失时必须读取有效 fallback');

idbControl.failNextGet = true;
globalThis.localStorage = {
    getItem: key => key === FALLBACK_KEY ? JSON.stringify([{ id: 'read-fallback', name: '读取故障后备', images: [] }]) : null,
    setItem() {},
    removeItem() {},
};
await loadEmojis();
assert.equal(window.__pmEmojis[0].id, 'read-fallback', '主存储读取失败时必须使用有效 fallback');

let fallbackWritten = null;
idbControl.failNextPut = true;
globalThis.localStorage = {
    getItem: () => null,
    setItem: (key, value) => { if (key === FALLBACK_KEY) fallbackWritten = JSON.parse(value); },
    removeItem() {},
};
window.__pmEmojis = [{ id: 'write-fallback', name: '写入故障后备', images: [] }];
await saveEmojis();
assert.equal(fallbackWritten[0].id, 'write-fallback', '主存储写入失败时必须保存完整 fallback');

idbControl.failNextPut = true;
globalThis.localStorage = {
    getItem: () => null,
    setItem() { throw new Error('fallback write denied'); },
    removeItem() {},
};
await assert.rejects(saveEmojis(), /表情包保存失败：浏览器存储不可用或空间不足/);

globalThis.localStorage = {
    getItem: key => key === FALLBACK_KEY ? '{broken-json' : null,
    setItem() {},
    removeItem() { throw new Error('broken fallback delete denied'); },
};
await loadEmojis();
assert.deepEqual(window.__pmEmojis, [], '损坏 fallback 清理失败后必须收敛为空表情库');
assert.ok(warnings.some(args => String(args[0]).includes('表情包损坏后备数据清理失败')));
console.log('emoji storage checks passed');
