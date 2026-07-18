import assert from 'node:assert/strict';
import { createAiClient } from '../src/ai.js';

let config = {};
let groupMode = false;
let fetchRequest;
const hostCalls = [];
const rawCalls = [];
const context = {
    async generateQuietPrompt(...args) {
        hostCalls.push(args);
        return 'host reply';
    },
    async generateRaw(options) {
        rawCalls.push(options);
        return '{"version":1,"kind":"feed_batch","items":[]}';
    },
};

const callAI = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    getDefaultMaxTokens: () => groupMode ? 600 : 300,
    fetchImpl: async (url, options) => {
        fetchRequest = { url, options };
        return {
            ok: true,
            async json() { return { choices: [{ message: { content: 'api reply' } }] }; },
        };
    },
});

assert.equal(await callAI('system', 'user'), 'host reply');
assert.deepEqual(hostCalls.pop(), [{ quietPrompt: 'system\n\nuser', responseLength: 300 }]);
assert.equal(await callAI('', 'plain'), 'host reply');
assert.deepEqual(hostCalls.pop(), [{ quietPrompt: 'plain', responseLength: 300 }]);

groupMode = true;
assert.equal(
    await callAI('community system', 'community user', { isolated: true, maxTokens: 1400 }),
    '{"version":1,"kind":"feed_batch","items":[]}',
);
assert.deepEqual(rawCalls.pop(), {
    prompt: 'community user', systemPrompt: 'community system', responseLength: 1400, trimNames: false,
});

config = {
    useIndependent: true,
    apiUrl: 'https://example.test/v1/',
    apiKey: 'secret',
    model: 'provider-model',
};
assert.equal(await callAI('system', 'user'), 'api reply');
assert.equal(fetchRequest.url, 'https://example.test/v1/chat/completions');
assert.equal(fetchRequest.options.method, 'POST');
assert.equal(fetchRequest.options.headers.Authorization, 'Bearer secret');
assert.equal(fetchRequest.options.headers['Content-Type'], 'application/json');
let body = JSON.parse(fetchRequest.options.body);
assert.equal(body.model, 'provider-model');
assert.equal(body.max_tokens, 600);
assert.equal(body.temperature, 1.2);
assert.equal(body.top_p, 0.95);
assert.equal(body.frequency_penalty, 0.3);
assert.equal(body.presence_penalty, 0.3);
assert.deepEqual(body.messages, [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'user' },
]);

const requestController = new AbortController();
await callAI('', 'signal propagation', { signal: requestController.signal });
assert.equal(fetchRequest.options.signal, requestController.signal, '独立 API 请求必须接收调用方 AbortSignal');
requestController.abort('test-complete');

const alreadyAborted = new AbortController();
alreadyAborted.abort('cancel-before-start');
await assert.rejects(
    () => callAI('', 'cancelled before request', { signal: alreadyAborted.signal }),
    error => error.name === 'AbortError' && /已取消/.test(error.message),
);

const inFlightController = new AbortController();
const abortingClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    getDefaultMaxTokens: () => 300,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('provider aborted'); error.name = 'AbortError'; reject(error);
        }, { once: true });
    }),
});
const inFlightRequest = abortingClient('', 'cancel in flight', { signal: inFlightController.signal });
inFlightController.abort('cancel-in-flight');
await assert.rejects(inFlightRequest, error => error.name === 'AbortError' && /已取消/.test(error.message));

await callAI('', 'user', { maxTokens: 125 });
body = JSON.parse(fetchRequest.options.body);
assert.equal(body.max_tokens, 125);
assert.deepEqual(body.messages, [{ role: 'user', content: 'user' }]);

const emptyResponseClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    getDefaultMaxTokens: () => 300,
    fetchImpl: async () => ({ ok: true, async json() { return {}; } }),
});
await assert.rejects(() => emptyResponseClient('', 'user'), /缺少可用文本内容/);

for (const [label, payload, expected] of [
    ['completion text', { choices: [{ text: ' completion reply ' }] }, 'completion reply'],
    ['output text', { output_text: ' output reply ' }, 'output reply'],
    ['candidate parts', { candidates: [{ content: { parts: [{ text: 'candidate ' }, { text: 'reply' }] } }] }, 'candidate reply'],
]) {
    const compatibleClient = createAiClient({
        getConfig: () => config,
        getContext: () => context,
        getDefaultMaxTokens: () => 300,
        fetchImpl: async () => ({ ok: true, async json() { return payload; } }),
    });
    assert.equal(await compatibleClient('', label), expected, label);
}

const errorText = 'x'.repeat(300);
const failingClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    getDefaultMaxTokens: () => 300,
    fetchImpl: async () => ({ ok: false, status: 429, async text() { return errorText; } }),
});
await assert.rejects(() => failingClient('', 'user'), error => {
    assert.equal(error.message, `HTTP 429: ${'x'.repeat(240)}`);
    return true;
});

const errorBodyDeferred = () => {
    let resolve, reject;
    const promise = new Promise((resolve_, reject_) => { resolve = resolve_; reject = reject_; });
    return { promise, reject, resolve };
};
const errorBodyGate = errorBodyDeferred();
const errorBodyController = new AbortController();
const errorBodyClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    getDefaultMaxTokens: () => 300,
    fetchImpl: async () => ({
        ok: false, status: 503,
        text: () => errorBodyGate.promise,
    }),
});
const errorBodyRequest = errorBodyClient('', 'abort while reading error body', { signal: errorBodyController.signal });
await Promise.resolve();
errorBodyController.abort('cancel-error-body');
errorBodyGate.resolve('busy');
await assert.rejects(errorBodyRequest, error => error.name === 'AbortError' && /已取消/.test(error.message));

const rejectedBodyController = new AbortController();
const rejectedBodyClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    getDefaultMaxTokens: () => 300,
    fetchImpl: async () => ({
        ok: false, status: 503,
        async text() {
            rejectedBodyController.abort('body-aborted');
            const error = new Error('body stream aborted');
            error.name = 'AbortError';
            throw error;
        },
    }),
});
await assert.rejects(
    () => rejectedBodyClient('', 'error body rejects', { signal: rejectedBodyController.signal }),
    error => error.name === 'AbortError' && /已取消/.test(error.message),
);

const textFailureClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    getDefaultMaxTokens: () => 300,
    fetchImpl: async () => ({ ok: false, status: 500, async text() { throw new Error('unreadable'); } }),
});
await assert.rejects(
    () => textFailureClient('', 'user'),
    error => error.message === 'HTTP 500',
);

const jsonErrorClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    getDefaultMaxTokens: () => 300,
    fetchImpl: async () => ({
        ok: false,
        status: 400,
        async text() { return JSON.stringify({ error: { message: 'model is not available' } }); },
    }),
});
await assert.rejects(
    () => jsonErrorClient('', 'user'),
    error => error.message === 'HTTP 400: model is not available',
);

const noContextClient = createAiClient({
    getConfig: () => ({}),
    getContext: () => null,
    getDefaultMaxTokens: () => 300,
});
await assert.rejects(() => noContextClient('', 'user'), /无上下文/);

config = { useIndependent: true, apiUrl: '', apiKey: 'secret' };
await assert.rejects(() => callAI('', 'missing url'), /未填写地址/);

config = { useIndependent: true, apiUrl: 'https://example.test/v1', apiKey: '' };
await assert.rejects(() => callAI('', 'missing key'), /未填写密钥/);

config = { useIndependent: true, apiUrl: 'https://example.test/v1', apiKey: 'secret', model: '' };
await assert.rejects(() => callAI('', 'missing model'), /未选择模型/);

config = {};

const boundContext = {
    marker: 'bound reply',
    generateQuietPrompt() {
        assert.equal(this, boundContext);
        return this.marker;
    },
};
const boundContextClient = createAiClient({
    getConfig: () => ({}),
    getContext: () => boundContext,
    getDefaultMaxTokens: () => 300,
});
assert.equal(await boundContextClient('', 'binding'), 'bound reply');

const originalFetch = globalThis.fetch;
let globalFetchThis;
try {
    globalThis.fetch = async function (url) {
        globalFetchThis = this;
        assert.equal(url, 'https://example.test/v1/chat/completions');
        return { ok: true, async json() { return { choices: [{ message: { content: 'global reply' } }] }; } };
    };
    const globalFetchClient = createAiClient({
        getConfig: () => ({ useIndependent: true, apiUrl: 'https://example.test/v1', apiKey: 'secret', model: 'global-model' }),
        getContext: () => context,
        getDefaultMaxTokens: () => 300,
    });
    assert.equal(await globalFetchClient('', 'global fetch'), 'global reply');
    assert.equal(globalFetchThis, globalThis);
} finally {
    globalThis.fetch = originalFetch;
}

console.log('AI client behavior verified.');
