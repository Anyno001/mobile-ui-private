import assert from 'node:assert/strict';
import {
    createAiClient, DEFAULT_INDEPENDENT_API_TEMPERATURE, generationErrorMessage,
    normalizeIndependentApiTemperature, parseFirstJsonObject,
} from '../src/ai.js';
import {
    buildGeneratedDirectoryCandidates, commitGeneratedDirectory, parseGeneratedDirectory,
    shouldReportGeneratedDirectoryError, installContactGenerator,
} from '../src/contact-generator.js';
import {
    enqueueDirectorySave, getDirectorySaveRevision,
} from '../src/directory-save-coordinator.js';

assert.deepEqual(parseFirstJsonObject('<think>{"wrong":true}</think>以下是结果：```json\n{"contacts":["甲{乙}"],"groups":[]}\n```'), { contacts: ['甲{乙}'], groups: [] });
assert.deepEqual(parseFirstJsonObject('说明 {not json} 后续 {"value":"保留 <think>字面量</think> 与 \\"引号\\""}'), { value: '保留 <think>字面量</think> 与 "引号"' });
assert.deepEqual(parseFirstJsonObject('{"trace":1}\n最终：{"contacts":["甲"],"groups":[]}', 'missing', value => Array.isArray(value?.contacts)), {
    contacts: ['甲'], groups: [],
});
assert.throws(() => parseFirstJsonObject('只有终端日志：fatal: no json'), /可解析的 JSON/);
assert.match(generationErrorMessage(Object.assign(new Error("Username for 'https://github.com':"), { name: 'GitError' })), /扩展仓库配置|GitHub 认证/);
assert.match(generationErrorMessage(new Error("fatal: couldn't find remote ref refs/heads/release")), /扩展仓库配置|GitHub 认证/);
assert.equal(generationErrorMessage(new Error('角色名 GitHub 不符合协议')), '角色名 GitHub 不符合协议');
assert.equal(generationErrorMessage(new Error('GitHub webhook failed to fetch profile')), 'GitHub webhook failed to fetch profile');
assert.equal(generationErrorMessage(new TypeError('Failed to fetch GitHub API webhook metadata')), 'Failed to fetch GitHub API webhook metadata');
assert.equal(generationErrorMessage(Object.assign(new Error('联系人协议校验失败'), { name: 'GitError' })), '联系人协议校验失败');
assert.match(generationErrorMessage(new TypeError('Failed to fetch')), /AI 服务网络连接失败/);

assert.equal(DEFAULT_INDEPENDENT_API_TEMPERATURE, 1.2);
assert.equal(normalizeIndependentApiTemperature(undefined), 1.2);
assert.equal(normalizeIndependentApiTemperature(''), 1.2);
assert.equal(normalizeIndependentApiTemperature(0), 0);
assert.equal(normalizeIndependentApiTemperature('2'), 2);
assert.equal(normalizeIndependentApiTemperature(-0.1), 1.2);
assert.equal(normalizeIndependentApiTemperature(2.1), 1.2);

const coordinatorOrder = [];
await assert.rejects(enqueueDirectorySave('histories', { value: 1 }, async () => {
    coordinatorOrder.push('failed'); throw new Error('queue-failed');
}), /queue-failed/);
await enqueueDirectorySave('histories', { value: 2 }, async snapshot => { coordinatorOrder.push(`recovered-${snapshot.value}`); });
assert.deepEqual(coordinatorOrder, ['failed', 'recovered-2']);
const revisionBeforeMark = getDirectorySaveRevision();
await enqueueDirectorySave('groupMeta', {}, async () => {}, true);
assert.equal(getDirectorySaveRevision().groupMeta, revisionBeforeMark.groupMeta + 1);

assert.deepEqual(parseGeneratedDirectory('<think>先分析</think>以下是结果：```json\n[{"contacts":["甲"],"groups":[{"name":"同行会","members":["乙","丙"]}]}]\n```'), {
    contacts: ['甲'], groups: [{ name: '同行会', members: ['乙', '丙'] }],
});
assert.deepEqual(parseGeneratedDirectory('说明 {"trace":1}\n最终 {"contacts":["后置角色"],"groups":[]}'), {
    contacts: ['后置角色'], groups: [],
});
assert.deepEqual(parseGeneratedDirectory('{"contacts":["<think>字面角色</think>"]}'), {
    contacts: ['<think>字面角色</think>'], groups: [],
});
assert.throws(() => parseGeneratedDirectory('{"characters":["甲"]}'), /缺少 contacts 或 groups/);
assert.throws(() => parseGeneratedDirectory('{"contacts":"甲"}'), /contacts 必须是数组/);
assert.throws(() => parseGeneratedDirectory('{"contacts":[],"groups":[],"debug":true}'), /额外字段：debug/);
assert.throws(() => parseGeneratedDirectory('{"contacts":[{"name":"甲"}],"groups":[]}'), /contacts 每项必须是字符串/);
assert.throws(() => parseGeneratedDirectory('{"contacts":[],"groups":["群"]}'), /groups 每项必须是对象/);
assert.throws(() => parseGeneratedDirectory('{"contacts":[],"groups":[{"name":"群","members":["甲","乙"],"debug":true}]}'), /群聊包含额外字段：debug/);
assert.throws(() => parseGeneratedDirectory('{"contacts":[],"groups":[{"name":1,"members":["甲","乙"]}]}'), /群聊 name 必须是字符串/);
assert.throws(() => parseGeneratedDirectory('{"contacts":[],"groups":[{"name":"群","members":"甲、乙"}]}'), /群聊 members 必须是数组/);
assert.throws(() => parseGeneratedDirectory('{"contacts":[],"groups":[{"name":"群","members":["甲",{"name":"乙"}]}]}'), /members 每项必须是字符串/);
assert.deepEqual(buildGeneratedDirectoryCandidates({
    contacts: [' 已有 ', '用户', '新角色', '新角色'],
    groups: [
        { name: '新群', members: ['甲', '甲', '用户', '乙'] },
        { name: '无效群', members: ['甲'] },
    ],
}, ['已有'], '用户'), { contacts: ['新角色'], groups: [{ name: '新群', members: ['甲', '乙'] }] });
assert.throws(() => buildGeneratedDirectoryCandidates({ contacts: ['已有'], groups: [] }, ['已有'], '用户'), /未返回可添加/);

const previousWindow = globalThis.window;
try {
    globalThis.window = {
        __pmHistories: { story: { 已有: [{ role: 'assistant', content: '旧记录' }] } },
        __pmGroupMeta: { story: { old: { name: '旧群', members: ['甲', '乙'] } } },
    };
    const transactionCandidates = { contacts: ['新角色'], groups: [{ name: '新群', members: ['丙', '丁'] }] };
    let releaseGroups;
    const groupGate = new Promise(resolve => { releaseGroups = resolve; });
    const successCalls = [];
    const successPromise = commitGeneratedDirectory({
        id: 'story', candidates: transactionCandidates, isActive: () => true,
        persistHistories: async data => { successCalls.push(['histories', structuredClone(data)]); },
        persistGroupMeta: async data => { successCalls.push(['groups', structuredClone(data)]); await groupGate; return structuredClone(data); },
    });
    await Promise.resolve();
    assert.equal(Object.hasOwn(window.__pmHistories.story, '新角色'), false,
        '两份持久化完成前不得提前切换联系人内存状态');
    assert.equal(Object.values(window.__pmGroupMeta.story).some(group => group.name === '新群'), false,
        '两份持久化完成前不得提前切换群聊内存状态');
    releaseGroups();
    assert.equal(await successPromise, true);
    assert.equal(Object.hasOwn(window.__pmHistories.story, '新角色'), true);
    assert.equal(Object.values(window.__pmGroupMeta.story).some(group => group.name === '新群'), true);
    assert.deepEqual(successCalls.map(([kind]) => kind), ['histories', 'groups']);

    const resetTransactionState = () => {
        window.__pmHistories = { story: { 已有: [] } };
        window.__pmGroupMeta = { story: { old: { name: '旧群', members: ['甲', '乙'] } } };
    };
    resetTransactionState();
    const firstFailureCalls = [];
    await assert.rejects(commitGeneratedDirectory({
        id: 'story', candidates: transactionCandidates, isActive: () => true,
        persistHistories: async data => {
            firstFailureCalls.push(structuredClone(data));
            if (firstFailureCalls.length === 1) throw new Error('history-save-failed');
        },
        persistGroupMeta: async () => assert.fail('历史保存失败后不得继续保存群聊'),
    }), /history-save-failed/);
    assert.equal(firstFailureCalls.length, 2, '历史保存失败后必须等待旧快照补偿');
    assert.deepEqual(window.__pmHistories, { story: { 已有: [] } });
    assert.deepEqual(window.__pmGroupMeta, { story: { old: { name: '旧群', members: ['甲', '乙'] } } });

    resetTransactionState();
    const secondFailureCalls = [];
    await assert.rejects(commitGeneratedDirectory({
        id: 'story', candidates: transactionCandidates, isActive: () => true,
        persistHistories: async data => secondFailureCalls.push(['histories', structuredClone(data)]),
        persistGroupMeta: async data => {
            secondFailureCalls.push(['groups', structuredClone(data)]);
            if (secondFailureCalls.filter(([kind]) => kind === 'groups').length === 1) throw new Error('group-save-failed');
            return structuredClone(data);
        },
    }), /group-save-failed/);
    assert.deepEqual(secondFailureCalls.map(([kind]) => kind), ['histories', 'groups', 'groups', 'histories']);
    assert.deepEqual(window.__pmHistories, { story: { 已有: [] } });
    assert.deepEqual(window.__pmGroupMeta, { story: { old: { name: '旧群', members: ['甲', '乙'] } } });

    resetTransactionState();
    let active = true;
    const cancelledCalls = [];
    await assert.rejects(commitGeneratedDirectory({
        id: 'story', candidates: transactionCandidates, isActive: () => active,
        persistHistories: async data => { cancelledCalls.push(structuredClone(data)); active = false; },
        persistGroupMeta: async () => assert.fail('任务失效后不得保存群聊'),
    }), /生成已取消/);
    assert.equal(cancelledCalls.length, 2, '任务失效后必须等待历史旧快照补偿');
    assert.deepEqual(window.__pmHistories, { story: { 已有: [] } });

    resetTransactionState();
    let revision = { histories: 3, groupMeta: 4 };
    const conflictCalls = [];
    await assert.rejects(commitGeneratedDirectory({
        id: 'story', candidates: transactionCandidates, isActive: () => true,
        getRevision: () => ({ ...revision }),
        persistHistories: async data => {
            conflictCalls.push(['histories', structuredClone(data)]);
            if (conflictCalls.length === 1) {
                window.__pmHistories.story.并发联系人 = [];
                revision = { histories: 4, groupMeta: 4 };
            }
        },
        persistGroupMeta: async () => assert.fail('发现历史冲突后不得保存群聊'),
    }), /已被其他操作修改/);
    assert.equal(conflictCalls.length, 2, '冲突后必须等待当前历史状态补偿');
    assert.equal(Object.hasOwn(conflictCalls[1][1].story, '并发联系人'), true, '补偿不得用事务启动前旧快照覆盖并发数据');
    assert.equal(Object.hasOwn(window.__pmHistories.story, '并发联系人'), true);

    assert.equal(shouldReportGeneratedDirectoryError(new Error('生成已取消'), false), false);
    assert.equal(shouldReportGeneratedDirectoryError(new Error('生成已取消'), true), false);
    assert.equal(shouldReportGeneratedDirectoryError(Object.assign(new Error('provider aborted'), { name: 'AbortError' }), true), false);
    const rollbackFailure = new Error('生成已取消；联系人生成回滚失败');
    rollbackFailure.rollbackError = new AggregateError([new Error('rollback failed')]);
    assert.equal(shouldReportGeneratedDirectoryError(rollbackFailure, false), true);

    resetTransactionState();
    let historyCalls = 0;
    await assert.rejects(commitGeneratedDirectory({
        id: 'story', candidates: transactionCandidates, isActive: () => true,
        persistHistories: async () => { historyCalls += 1; if (historyCalls > 1) throw new Error('history-rollback-failed'); },
        persistGroupMeta: async () => { throw new Error('group-save-and-rollback-failed'); },
    }), error => error?.cause?.message === 'group-save-and-rollback-failed'
        && error.rollbackError instanceof AggregateError
        && /联系人生成回滚失败/.test(error.message));
} finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
}

const previousDocument = globalThis.document;
const previousAlert = globalThis.alert;
try {
    const createButton = () => ({
        disabled: false, attributes: new Map(), icon: { style: { animation: '' } },
        querySelector(selector) { return selector === 'svg' ? this.icon : null; },
        setAttribute(name, value) { this.attributes.set(name, value); },
    });
    let button = createButton();
    let addContactOpen = true;
    globalThis.document = { getElementById: id => id === 'pm-autogen-btn' && addContactOpen ? button : null };
    const alerts = [];
    globalThis.alert = message => alerts.push(message);
    globalThis.window = {
        __pmHistories: { story: {} },
        __pmGroupMeta: { story: {} },
    };
    const state = { generationTask: null };
    const shownResults = [];
    window.__pmShowAddContact = async message => {
        shownResults.push(message);
        button = createButton();
        addContactOpen = true;
    };
    let committedCandidates;
    let contactCallOptions;
    let contactTaskSignal;
    installContactGenerator(state, {
        getStorageId: () => 'story',
        gatherContext: async () => ({ userName: '用户' }),
        callAI: async (_systemPrompt, _userPrompt, options) => {
            contactCallOptions = options;
            return '{"contacts":["新角色"],"groups":[{"name":"新群","members":["甲","乙"]}]}';
        },
        beginGeneration: id => {
            const task = { id, context: {}, signal: new AbortController().signal };
            contactTaskSignal = task.signal;
            state.generationTask = task;
            return task;
        },
        isGenerationTaskActive: task => state.generationTask === task,
        finishGeneration: task => {
            if (state.generationTask !== task) return false;
            state.generationTask = null;
            return true;
        },
        commitDirectory: async ({ candidates }) => { committedCandidates = candidates; return true; },
    });
    await window.__pmAutoGenContacts();
    assert.deepEqual(committedCandidates, {
        contacts: ['新角色'], groups: [{ name: '新群', members: ['甲', '乙'] }],
    });
    assert.equal(Object.hasOwn(contactCallOptions, 'maxTokens'), false, '联系人生成不得设置服务商输出 token 上限');
    assert.equal(contactCallOptions.isolated, true, '联系人生成必须使用宿主隔离生成路径');
    assert.equal(contactCallOptions.signal, contactTaskSignal,
        '联系人生成必须把 generation task signal 传给 AI 客户端');
    assert.deepEqual(shownResults, ['已添加 1 位联系人、1 个群聊']);
    assert.deepEqual(alerts, []);
    assert.equal(button.disabled, false);
    assert.equal(button.attributes.get('aria-busy'), 'false');
    assert.equal(button.icon.style.animation, '');

    shownResults.length = 0;
    installContactGenerator(state, {
        getStorageId: () => 'story',
        gatherContext: async () => ({ userName: '用户' }),
        callAI: async () => '{"contacts":["取消角色"],"groups":[]}',
        beginGeneration: id => {
            const task = { id, context: {}, signal: new AbortController().signal };
            state.generationTask = task;
            return task;
        },
        isGenerationTaskActive: task => state.generationTask === task,
        finishGeneration: task => {
            if (state.generationTask !== task) return false;
            state.generationTask = null;
            return true;
        },
        commitDirectory: async () => false,
    });
    await window.__pmAutoGenContacts();
    assert.deepEqual(shownResults, [], '提交未完成时不得显示成功结果');
    assert.equal(button.disabled, false, '提交取消后必须恢复生成按钮');
    assert.equal(button.attributes.get('aria-busy'), 'false');

    alerts.length = 0;
    installContactGenerator(state, {
        getStorageId: () => 'story',
        gatherContext: async () => { throw new Error('context-failed'); },
        callAI: async () => assert.fail('上下文失败后不得调用 AI'),
        beginGeneration: id => {
            const task = { id, context: {}, signal: new AbortController().signal };
            state.generationTask = task;
            return task;
        },
        isGenerationTaskActive: task => state.generationTask === task,
        finishGeneration: task => {
            if (state.generationTask !== task) return false;
            state.generationTask = null;
            return true;
        },
        commitDirectory: async () => assert.fail('上下文失败后不得提交目录'),
    });
    await window.__pmAutoGenContacts();
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /自动生成失败：context-failed/);
    assert.equal(button.disabled, false, '异常路径必须恢复生成按钮');
    assert.equal(button.attributes.get('aria-busy'), 'false');

    alerts.length = 0;
    shownResults.length = 0;
    let releaseFirstAi;
    let releaseSecondCommit;
    const firstAi = new Promise(resolve => { releaseFirstAi = resolve; });
    const secondCommit = new Promise(resolve => { releaseSecondCommit = resolve; });
    let aiCallCount = 0;
    let commitCallCount = 0;
    installContactGenerator(state, {
        getStorageId: () => 'story',
        gatherContext: async () => ({ userName: '用户' }),
        callAI: async () => {
            aiCallCount += 1;
            if (aiCallCount === 1) return firstAi;
            return '{"contacts":["第二任务"],"groups":[]}';
        },
        beginGeneration: id => {
            const task = { id, context: {}, signal: new AbortController().signal };
            state.generationTask = task;
            return task;
        },
        isGenerationTaskActive: task => state.generationTask === task,
        finishGeneration: task => {
            if (state.generationTask !== task) return false;
            state.generationTask = null;
            return true;
        },
        commitDirectory: async () => {
            commitCallCount += 1;
            await secondCommit;
            return true;
        },
    });
    const firstTask = window.__pmAutoGenContacts();
    await Promise.resolve();
    await Promise.resolve();
    const secondTask = window.__pmAutoGenContacts();
    while (commitCallCount === 0) await Promise.resolve();
    assert.equal(button.disabled, true);
    releaseFirstAi('{"contacts":["第一任务"],"groups":[]}');
    await firstTask;
    assert.equal(button.disabled, true, '旧任务 finally 不得清除新任务的 busy 状态');
    assert.equal(button.attributes.get('aria-busy'), 'true');
    releaseSecondCommit();
    await secondTask;
    assert.deepEqual(shownResults, ['已添加 1 位联系人']);
    assert.equal(button.disabled, false);
    assert.equal(button.attributes.get('aria-busy'), 'false');
    assert.deepEqual(alerts, []);
} finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousAlert === undefined) delete globalThis.alert;
    else globalThis.alert = previousAlert;
}

let config = {};
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
    fetchImpl: async (url, options) => {
        fetchRequest = { url, options };
        return {
            ok: true,
            async json() { return { choices: [{ message: { content: 'api reply' } }] }; },
        };
    },
});

assert.equal(await callAI('system', 'user'), 'host reply');
assert.deepEqual(hostCalls.pop(), [{ quietPrompt: 'system\n\nuser' }]);
assert.equal(await callAI('', 'plain'), 'host reply');
assert.deepEqual(hostCalls.pop(), [{ quietPrompt: 'plain' }]);

assert.equal(
    await callAI('community system', 'community user', { isolated: true }),
    '{"version":1,"kind":"feed_batch","items":[]}',
);
assert.deepEqual(rawCalls.pop(), {
    prompt: 'community user', systemPrompt: 'community system', trimNames: false,
});

let releaseLateHostResponse;
const lateHostResponse = new Promise(resolve => { releaseLateHostResponse = resolve; });
const lateHostClient = createAiClient({
    getConfig: () => ({}),
    getContext: () => ({ generateRaw: async () => lateHostResponse }),
    fetchImpl: async () => { throw new Error('主 API 测试不应调用 fetch'); },
});
const lateHostController = new AbortController();
const lateHostRequest = lateHostClient('system', 'late host response', {
    isolated: true, signal: lateHostController.signal,
});
await Promise.resolve();
lateHostController.abort('host-response-invalidated');
releaseLateHostResponse('late host reply');
await assert.rejects(
    lateHostRequest,
    error => error.name === 'AbortError' && /已取消/.test(error.message),
    '主 API generateRaw 返回后必须拒绝已取消的迟到结果',
);

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
assert.equal(Object.hasOwn(body, 'max_tokens'), false);
assert.equal(body.temperature, DEFAULT_INDEPENDENT_API_TEMPERATURE);
assert.equal(body.top_p, 0.95);
assert.equal(body.frequency_penalty, 0.3);
assert.equal(body.presence_penalty, 0.3);
assert.deepEqual(body.messages, [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'user' },
]);

config.temperature = 0;
assert.equal(await callAI('', 'deterministic'), 'api reply');
body = JSON.parse(fetchRequest.options.body);
assert.equal(body.temperature, 0, '独立 API 温度 0 必须原样发送');
config.temperature = 8;
assert.equal(await callAI('', 'invalid temperature fallback'), 'api reply');
body = JSON.parse(fetchRequest.options.body);
assert.equal(body.temperature, DEFAULT_INDEPENDENT_API_TEMPERATURE, '越界存储值必须回退默认温度');
config.temperature = DEFAULT_INDEPENDENT_API_TEMPERATURE;

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
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('provider aborted'); error.name = 'AbortError'; reject(error);
        }, { once: true });
    }),
});
const inFlightRequest = abortingClient('', 'cancel in flight', { signal: inFlightController.signal });
inFlightController.abort('cancel-in-flight');
await assert.rejects(inFlightRequest, error => error.name === 'AbortError' && /已取消/.test(error.message));

await callAI('', 'user');
body = JSON.parse(fetchRequest.options.body);
assert.equal(Object.hasOwn(body, 'max_tokens'), false);
assert.deepEqual(body.messages, [{ role: 'user', content: 'user' }]);

const emptyResponseClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    fetchImpl: async () => ({ ok: true, async json() { return {}; } }),
});
await assert.rejects(() => emptyResponseClient('', 'user'), /缺少可用文本内容/);

for (const [label, payload, expected] of [
    ['completion text', { choices: [{ text: ' completion reply ' }] }, 'completion reply'],
    ['output text', { output_text: ' output reply ' }, 'output reply'],
    ['root content', { content: ' root reply ' }, 'root reply'],
    ['responses output', { output: [{ content: [{ type: 'output_text', text: 'responses ' }, { type: 'output_text', text: 'reply' }] }] }, 'responses reply'],
    ['candidate parts', { candidates: [{ content: { parts: [{ text: 'candidate ' }, { text: 'reply' }] } }] }, 'candidate reply'],
    ['candidate thought filtering', { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'internal reasoning' }, { text: '{"visible":true}' }] } }] }, '{"visible":true}'],
]) {
    const compatibleClient = createAiClient({
        getConfig: () => config,
        getContext: () => context,
        fetchImpl: async () => ({ ok: true, async json() { return payload; } }),
    });
    assert.equal(await compatibleClient('', label), expected, label);
}

for (const [label, payload] of [
    ['Gemini MAX_TOKENS', {
        candidates: [{
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ thought: true, text: 'internal reasoning' }, { text: '{"items":' }] },
        }],
    }],
    ['OpenAI length', {
        choices: [{ finish_reason: 'length', message: { content: '{"items":' } }],
    }],
]) {
    const truncatedClient = createAiClient({
        getConfig: () => config,
        getContext: () => context,
        fetchImpl: async () => ({ ok: true, async json() { return payload; } }),
    });
    await assert.rejects(
        () => truncatedClient('', label),
        error => {
            assert.match(error.message, /token 上限|MAX_TOKENS/);
            assert.equal(generationErrorMessage(error), error.message);
            assert.doesNotMatch(error.message, /\{"items":/);
            return true;
        },
        `${label} 截断响应不得返回半截业务 JSON`,
    );
}

const nonJsonClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
    fetchImpl: async () => ({ ok: true, async text() { return '<html>502 Bad Gateway</html>'; } }),
});
await assert.rejects(() => nonJsonClient('', 'user'), error => {
    assert.match(error.message, /独立 API 返回了无法解析的 JSON/);
    assert.match(error.message, /502 Bad Gateway/);
    return true;
});

const errorText = 'x'.repeat(300);
const failingClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
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
    fetchImpl: async () => ({ ok: false, status: 500, async text() { throw new Error('unreadable'); } }),
});
await assert.rejects(
    () => textFailureClient('', 'user'),
    error => error.message === 'HTTP 500',
);

const jsonErrorClient = createAiClient({
    getConfig: () => config,
    getContext: () => context,
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
});
assert.equal(await boundContextClient('', 'binding'), 'bound reply');

const hadOriginalFetch = Object.hasOwn(globalThis, 'fetch');
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
    });
    assert.equal(await globalFetchClient('', 'global fetch'), 'global reply');
    assert.equal(globalFetchThis, globalThis);
} finally {
    if (hadOriginalFetch) globalThis.fetch = originalFetch;
    else delete globalThis.fetch;
}

console.log('AI client behavior verified.');
