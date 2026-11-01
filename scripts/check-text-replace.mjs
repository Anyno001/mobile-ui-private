import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAiClient } from '../src/ai.js';
import {
    applyTextReplace, compileTextReplaceRule, loadTextReplaceRules, normalizeTextReplaceRules, saveTextReplaceRules, TEXT_REPLACE_KEY,
} from '../src/text-replace.js';

const rule = (find, replace, enabled = true) => ({ find, replace, enabled });

// 普通文本：全部替换，不把特殊字符当正则
assert.equal(applyTextReplace('逆家A说，逆家B也说', [rule('逆家', '我家')]), '我家A说，我家B也说');
assert.equal(applyTextReplace('a.b a.b axb', [rule('a.b', 'X')]), 'X X axb');
// 正则：带标志与捕获组
assert.equal(applyTextReplace('张三和张四', [rule('/张(三|四)/', '李$1')]), '李三和李四');
assert.equal(applyTextReplace('Abc abc', [rule('/abc/i', 'x')]), 'x x');
// 非法正则不崩，其余规则照常
assert.equal(compileTextReplaceRule(rule('/(/', 'x')), null);
assert.equal(applyTextReplace('甲乙', [rule('/(/', 'x'), rule('甲', '丙')]), '丙乙');
// 关闭的规则、空查找不生效
assert.equal(applyTextReplace('甲乙', [rule('甲', '丙', false), rule('', 'z')]), '甲乙');
assert.equal(applyTextReplace(null, [rule('甲', '丙')]), null);
assert.deepEqual(normalizeTextReplaceRules([null, { find: 1 }, rule('a', 'b', false)]), [rule('1', '', true), rule('a', 'b', false)]);
assert.deepEqual(normalizeTextReplaceRules('x'), []);

// 存取：写入后立即生效，读取容错
const store = new Map();
globalThis.localStorage = { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)) };
assert.equal(saveTextReplaceRules([rule('逆家', '我家')]), true);
assert.equal(JSON.parse(store.get(TEXT_REPLACE_KEY))[0].replace, '我家');
store.set(TEXT_REPLACE_KEY, '{坏');
assert.deepEqual(loadTextReplaceRules(), []);
assert.equal(saveTextReplaceRules([rule('逆家', '我家')]), true);

// 钩子：AI 输出路径（独立API、酒馆生成）都经过替换
const apiReply = { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '逆家来了' } }] }) };
const callApi = createAiClient({ getConfig: () => ({ useIndependent: true, apiUrl: 'http://x', apiKey: 'k', model: 'm' }), getContext: () => null, fetchImpl: async () => apiReply });
assert.equal(await callApi('', 'hi'), '我家来了');
const hostContext = { generateQuietPrompt: async () => '逆家 quiet', generateRaw: async () => '逆家 raw' };
const callHost = createAiClient({ getConfig: () => ({}), getContext: () => hostContext });
assert.equal(await callHost('', 'hi'), '我家 quiet');
assert.equal(await callHost('', 'hi', { isolated: true }), '我家 raw');

// 钩子位置：源码中 callAI 三处返回均调用 applyTextReplace
const aiSource = readFileSync(new URL('../src/ai.js', import.meta.url), 'utf8');
assert.equal((aiSource.match(/return applyTextReplace\(/g) || []).length, 3);
// 设置入口与备份清理键已登记
assert.match(readFileSync(new URL('../src/settings-templates.js', import.meta.url), 'utf8'), /__pmShowConfig\('text-replace'\)/);
assert.match(readFileSync(new URL('../src/storage.js', import.meta.url), 'utf8'), /'ST_SMS_TEXT_REPLACE'/);

console.log('check-text-replace: ok');
