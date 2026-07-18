import assert from 'node:assert/strict';
import { createAiClient } from '../src/ai.js';
import {
    DEFAULT_BUDGET_CONFIG, allocateContextBudget, estimateContextTokens,
    normalizeBudgetConfig, trimToEstimatedTokens,
} from '../src/budget.js';
import { loadBudgetConfig, saveBudgetConfig } from '../src/storage.js';
import { getBudgetPercentageView, resolveBudgetPercentageInput } from '../src/settings-templates.js';

assert.deepEqual(normalizeBudgetConfig(), DEFAULT_BUDGET_CONFIG);
const normalized = normalizeBudgetConfig({
    budgetVersion: 999,
    targetTokens: Number.POSITIVE_INFINITY,
    sourceWeights: { phone: -1, community: '1' },
    sourcePriority: ['unknown', 'phone', 'phone'],
    redistributeUnused: 'yes',
    communityEnabled: true,
    communityPosition: 999,
    communityDepth: -4,
    communitySceneIdsByStorage: { story: [' scene-a ', 'scene-a', '', 3] },
});
assert.equal(normalized.budgetVersion, 1);
assert.equal(normalized.targetTokens, DEFAULT_BUDGET_CONFIG.targetTokens);
assert.deepEqual(normalized.sourceWeights, DEFAULT_BUDGET_CONFIG.sourceWeights);
assert.deepEqual(normalized.sourcePriority, ['phone', 'community', 'calendar']);
assert.equal(normalized.redistributeUnused, DEFAULT_BUDGET_CONFIG.redistributeUnused);
assert.equal(normalized.communityEnabled, true);
assert.equal(normalized.communityPosition, DEFAULT_BUDGET_CONFIG.communityPosition);
assert.equal(normalized.communityDepth, DEFAULT_BUDGET_CONFIG.communityDepth);
assert.deepEqual(normalized.communitySceneIdsByStorage.story, ['scene-a']);

const percentageView = getBudgetPercentageView({ phone: 2, community: 1, calendar: 1 });
assert.deepEqual(percentageView, { phone: 50, community: 25, calendar: 25 });
assert.deepEqual(resolveBudgetPercentageInput({
    sourceWeights: { phone: 2, community: 1, calendar: 1 },
    phone: '50', community: '25', calendar: '25',
    initialPhone: '50', initialCommunity: '25', initialCalendar: '25',
}), { phone: 2, community: 1, calendar: 1 }, '未编辑百分比时必须保留原始权重');
assert.deepEqual(resolveBudgetPercentageInput({
    sourceWeights: { phone: 2, community: 1, calendar: 1 },
    phone: '50', community: '30', calendar: '20',
    initialPhone: '50', initialCommunity: '25', initialCalendar: '25',
}), { phone: 50, community: 30, calendar: 20 });
assert.throws(() => resolveBudgetPercentageInput({
    sourceWeights: { phone: 2, community: 1, calendar: 1 },
    phone: '60', community: '30', calendar: '20',
    initialPhone: '50', initialCommunity: '25', initialCalendar: '25',
}), /合计必须为 100%/);
assert.throws(() => resolveBudgetPercentageInput({
    sourceWeights: { phone: 2, community: 1, calendar: 1 },
    phone: '-1', community: '81', calendar: '20',
    initialPhone: '50', initialCommunity: '25', initialCalendar: '25',
}), /0 到 100/);

assert.equal(estimateContextTokens('abcd').estimatedTokens, 1);
assert.equal(estimateContextTokens('中文').estimatedTokens, 2);
assert.equal(estimateContextTokens('').estimatedTokens, 0);

const fixed = allocateContextBudget({
    config: { targetTokens: 100, sourceWeights: { phone: 3, community: 1 }, redistributeUnused: false },
    safeMaxTokens: 200,
    demandBySource: { phone: 100, community: 100 },
});
assert.equal(fixed.totalBudgetTokens, 100);
assert.deepEqual(fixed.allocations, { phone: 75, community: 25, calendar: 0 });

const redistributed = allocateContextBudget({
    config: {
        targetTokens: 100,
        sourceWeights: { phone: 3, community: 1 },
        sourcePriority: ['community', 'phone'],
        redistributeUnused: true,
    },
    safeMaxTokens: 100,
    demandBySource: { phone: 10, community: 100 },
});
assert.deepEqual(redistributed.allocations, { phone: 10, community: 90, calendar: 0 });
assert.equal(redistributed.allocatedTokens, 100);

for (const requestedDemand of [11999, 12000, 12001, 24000]) {
    const saturated = allocateContextBudget({
        config: { targetTokens: 100, sourceWeights: { phone: 1, community: 0 }, redistributeUnused: true },
        safeMaxTokens: 100,
        demandBySource: { phone: requestedDemand, community: 0 },
    });
    assert.ok(saturated.allocations.phone > 0, `demand ${requestedDemand} 不得被归零`);
    assert.ok(saturated.allocatedTokens <= saturated.totalBudgetTokens);
    assert.equal(saturated.demandBySource.phone, Math.min(requestedDemand, 12000));
}

const trimmed = trimToEstimatedTokens('中文abcdef中文abcdef', 5, '【省略】');
assert.ok(estimateContextTokens(trimmed.text).estimatedTokens <= 5);
assert.equal(trimmed.truncated, true);
const unicodeTrimmed = trimToEstimatedTokens('前缀😀😀😀结尾', 3, '');
assert.ok(estimateContextTokens(unicodeTrimmed.text).estimatedTokens <= 3);
assert.equal(unicodeTrimmed.text.includes('\uFFFD'), false);
for (let index = 0; index < unicodeTrimmed.text.length; index += 1) {
    const codeUnit = unicodeTrimmed.text.charCodeAt(index);
    assert.equal(codeUnit >= 0xDC00 && codeUnit <= 0xDFFF && (index === 0 || unicodeTrimmed.text.charCodeAt(index - 1) < 0xD800 || unicodeTrimmed.text.charCodeAt(index - 1) > 0xDBFF), false);
}

const storedValues = new Map();
globalThis.window = {};
globalThis.localStorage = {
    getItem(key) { return storedValues.has(key) ? storedValues.get(key) : null; },
    setItem(key, value) { storedValues.set(key, value); },
};
storedValues.set('ST_SMS_BUDGET_CONFIG', JSON.stringify({
    targetTokens: 321,
    sourceWeights: { phone: 2, community: 1 },
    communityEnabled: true,
    communitySceneIdsByStorage: { story: ['scene-a'] },
}));
assert.equal(loadBudgetConfig().targetTokens, 321);
assert.equal(window.__pmBudgetConfig.budgetVersion, 1);
assert.deepEqual(window.__pmBudgetConfig.sourceWeights, { phone: 2, community: 1, calendar: 0 });
window.__pmBudgetConfig.targetTokens = 654;
assert.equal(saveBudgetConfig(), true);
assert.equal(JSON.parse(storedValues.get('ST_SMS_BUDGET_CONFIG')).targetTokens, 654);
globalThis.localStorage = {
    getItem() { return '{broken'; },
    setItem() { throw new Error('quota'); },
};
assert.deepEqual(loadBudgetConfig(), DEFAULT_BUDGET_CONFIG);
const previousBudgetConfig = normalizeBudgetConfig({ targetTokens: 123, communityEnabled: false });
window.__pmBudgetConfig = previousBudgetConfig;
const failedCandidate = normalizeBudgetConfig({ targetTokens: 999, communityEnabled: true });
assert.equal(saveBudgetConfig(failedCandidate), false);
assert.equal(window.__pmBudgetConfig, previousBudgetConfig);
assert.equal(window.__pmBudgetConfig.targetTokens, 123);
assert.equal(window.__pmBudgetConfig.communityEnabled, false);
delete globalThis.localStorage;
delete globalThis.window;

let groupMode = false;
let requestBody;
const callAI = createAiClient({
    getConfig: () => ({ useIndependent: true, apiUrl: 'https://example.test/v1', apiKey: 'secret', model: 'm' }),
    getContext: () => ({}),
    getDefaultMaxTokens: () => groupMode ? 600 : 300,
    fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return { ok: true, async json() { return { choices: [{ message: { content: 'ok' } }] }; } };
    },
});
let budgetConfig = normalizeBudgetConfig({ targetTokens: 800 });
await callAI('', 'single');
assert.equal(requestBody.max_tokens, 300);
budgetConfig = normalizeBudgetConfig({ ...budgetConfig, targetTokens: 9000, communityEnabled: true });
groupMode = true;
await callAI('', 'group');
assert.equal(requestBody.max_tokens, 600);
await callAI('', 'explicit', { maxTokens: 125 });
assert.equal(requestBody.max_tokens, 125);
assert.equal(budgetConfig.targetTokens, 9000);

console.log('Context budget verified.');
