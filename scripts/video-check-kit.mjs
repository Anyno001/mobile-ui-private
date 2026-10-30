import assert from 'node:assert/strict';
import { createEmptyInteractiveScope, createEmptyInteractiveStore } from '../src/interactive-scene-model.js';

// check-video.mjs 与 check-video-lifecycle.mjs 共用的断言计数与夹具。
export const stats = { passed: 0, assertions: 0 };
export const check = async (name, run) => {
    try { await run(); stats.passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; }
};
export const eq = (actual, expected, message) => { stats.assertions += 1; assert.deepEqual(actual, expected, message); };
export const ok = (value, message) => { stats.assertions += 1; assert.ok(value, message); };
export const match = (text, pattern, message) => { stats.assertions += 1; assert.match(text, pattern, message); };
export const nomatch = (text, pattern, message) => { stats.assertions += 1; assert.doesNotMatch(text, pattern, message); };
export const throwsRe = (run, pattern, message) => { stats.assertions += 1; assert.throws(run, pattern, message); };
export const clone = value => JSON.parse(JSON.stringify(value));

export const SCOPE = 'story';
export const story = { type: 'story', displayName: '林晚', bindingKey: 'character:linwan.png', profile: '图书管理员' };
export const me = { type: 'user', displayName: '我', bindingKey: 'persona:me', profile: '' };
export const makeScope = (scopeId = SCOPE) => {
    const store = createEmptyInteractiveStore();
    const scope = store.scopes[scopeId] = createEmptyInteractiveScope();
    return { store, scope };
};
export const sampleCreate = () => ({
    video: { title: '雨夜散步', category: '生活', description: '一起走走', duration: 90, scenes: [{ at: 0, text: '开场' }, { at: 30, text: '高潮', image: '画面描述' }], cover: '封面' },
    danmaku: [{ author: '路人甲', content: '前方高能', at: 12 }, { author: '路人乙', content: '哈哈', at: 40 }],
    comments: [
        { author: '乙', content: '好看', replies: [{ author: '林晚', content: '谢谢', replyTo: '乙' }, { author: '丙', content: '同意', replyTo: '乙' }, { author: '丁', content: '+1' }] },
        { author: '戊', content: '课代表' },
    ],
});
export const envelope = (kind, items, meta) => JSON.stringify({ version: 2, kind, items, ...(meta ? { meta } : {}) });
