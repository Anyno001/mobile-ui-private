// 新消息提醒演出：是否提醒与文案拼装的定向检查。
import assert from 'node:assert/strict';
import { buildChatNotice, buildFeedNotice, notifyIgs, shouldNotifyIgs } from '../src/igs-notify-bridge.js';
import { normalizeIgsLinkConfig } from '../src/igs-feed-core.js';

const on = { enabled: true, notifyOnNew: true };
const fakeGlobal = () => {
    const calls = [];
    return { calls, IGS: { api: { notify: { show: payload => { calls.push(payload); return { played: true }; } } } } };
};

assert.equal(normalizeIgsLinkConfig({}).notifyOnNew, false, '默认关');
assert.equal(normalizeIgsLinkConfig({ notifyOnNew: true }).notifyOnNew, true);

// 开关关闭一次都不调用
for (const config of [{ enabled: true, notifyOnNew: false }, { enabled: false, notifyOnNew: true }, undefined]) {
    const g = fakeGlobal();
    assert.equal(notifyIgs({ config, viewing: false, notice: { sender: 'a', text: 'b' }, globalObject: g }), null);
    assert.equal(g.calls.length, 0);
}

// 接口不存在或抛错都不报错
assert.equal(notifyIgs({ config: on, viewing: false, notice: { sender: 'a', text: 'b' }, globalObject: {} }), null);
assert.equal(notifyIgs({ config: on, viewing: false, notice: { sender: 'a', text: 'b' }, globalObject: { IGS: { api: { notify: {} } } } }), null);
assert.equal(notifyIgs({ config: on, viewing: false, notice: { sender: 'a', text: 'b' }, globalObject: { IGS: { api: { notify: { show() { throw new Error('x'); } } } } } }), null);

// 正常调用
{
    const g = fakeGlobal();
    const result = notifyIgs({ config: on, viewing: false, notice: { sender: '小明', text: '在吗' }, globalObject: g });
    assert.deepEqual(result, { played: true });
    assert.deepEqual(g.calls, [{ sender: '小明', text: '在吗' }]);
}

// 当前正看着不提醒
assert.equal(shouldNotifyIgs({ config: on, viewing: true }), false);
{
    const g = fakeGlobal();
    assert.equal(notifyIgs({ config: on, viewing: true, notice: { sender: 'a', text: 'b' }, globalObject: g }), null);
    assert.equal(g.calls.length, 0);
}

// 聊天文案
assert.deepEqual(buildChatNotice({ contactName: '小红', sentences: ['你好呀', '在吗'] }), { sender: '小红', text: '你好呀' });
assert.deepEqual(buildChatNotice({ isGroup: true, contactName: 'g1', groupName: '三人群', blocks: [{ name: '甲', sentences: [] }, { name: '乙', sentences: ['到了'] }] }), { sender: '三人群', text: '乙：到了' });
assert.equal(buildChatNotice({ contactName: '小红', sentences: [] }), null);
assert.equal(Array.from(buildChatNotice({ contactName: 'a', sentences: ['字'.repeat(100)] }).text).length, 40);

// 社区文案：多条合并，单条用标题或开头
assert.deepEqual(buildFeedNotice({ appName: '微博', posts: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }), { sender: '微博', text: '3 条新动态' });
assert.deepEqual(buildFeedNotice({ appName: '微博', posts: [{ title: '热帖标题', content: '内容' }] }), { sender: '微博', text: '热帖标题' });
assert.deepEqual(buildFeedNotice({ appName: '微博', posts: [{ content: '只有内容' }] }), { sender: '微博', text: '只有内容' });
assert.equal(buildFeedNotice({ appName: '微博', posts: [] }), null);

console.log('igs notify checks passed');
