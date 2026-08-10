import { createTodayTrendCommitter } from './today-trend-commit.js';
import { createTodayTrendGenerationController } from './today-trend-generation.js';
import { createTodayTrendScheduler } from './today-trend-scheduler.js';
import { loadTodayTrendStore, saveTodayTrendStore } from './today-trend-storage.js';
import { createEmptyTodayTrendScope } from './today-trend-model.js';

export function installTodayTrend(_state, deps = {}) {
    const { runtime, callAI, getCtx, getStorageId } = deps;
    if (!runtime || typeof callAI !== 'function' || typeof getCtx !== 'function' || typeof getStorageId !== 'function') {
        throw new TypeError('今日风向安装依赖无效');
    }
    const localRuntime = runtime.todayTrend || (runtime.todayTrend = {});
    const load = deps.loadTodayTrendStore || loadTodayTrendStore;
    const save = deps.saveTodayTrendStore || saveTodayTrendStore;
    const loadStore = async ({ force = false } = {}) => {
        if (!force && localRuntime.store) return localRuntime.store;
        const loaded = await load();
        localRuntime.store = loaded;
        return loaded;
    };
    const committer = createTodayTrendCommitter({ runtime: localRuntime, load, save, refreshInjection: deps.applyBidirectionalInjection });
    const controller = (deps.createTodayTrendGenerationController || createTodayTrendGenerationController)({ callAI, getCtx });
    const scheduler = createTodayTrendScheduler({ controller, committer, getStore: loadStore, getStorageId,
        getChat: () => getCtx()?.chat || [] });
    const reloadStore = () => loadStore({ force: true });
    const nextPresetId = (store, storageId) => {
        let id = '';
        do {
            const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            id = `${storageId}:preset:${suffix}`;
        } while (store.presets[id]);
        return id;
    };
    let initialization = null;
    let ruleRegeneration = null;
    const currentIdentity = storageId => {
        const context = getCtx();
        const character = context?.characters?.[context?.characterId];
        if (!storageId || storageId !== getStorageId() || !character?.name) throw new Error('请先打开有效的角色聊天');
        return { storageId, characterId: String(character.avatar || context.characterId || '').trim(), characterName: character.name.trim() };
    };
    const initialize = async ({ worldBookNames, includeExistingChat = true, userRequirements = '', presetName = '', presetId = '', signal } = {}) => {
        const identity = currentIdentity(getStorageId());
        const existing = await loadStore();
        const requestedPresetId = String(presetId || '').trim();
        if (requestedPresetId && !existing.presets[requestedPresetId]) throw new Error('要重新初始化的世界预设不存在');
        const resolvedPresetId = requestedPresetId || nextPresetId(existing, identity.storageId);
        const expectedScope = existing.scopes[identity.storageId] ? structuredClone(existing.scopes[identity.storageId]) : null;
        const expectedScopePresetId = expectedScope?.presetId || '';
        const expectedPresetRevision = requestedPresetId ? existing.presets[requestedPresetId].revision : 0;
        initialization?.abortController.abort('today-trend-initialization-replaced');
        const task = { identity, abortController: new AbortController() };
        if (signal) signal.addEventListener('abort', () => task.abortController.abort(signal.reason), { once: true });
        initialization = task;
        const active = () => initialization === task && !task.abortController.signal.aborted && getStorageId() === identity.storageId;
        const result = await controller.initialize({ ...identity, worldBookNames, includeExistingChat, userRequirements, presetId: resolvedPresetId, signal: task.abortController.signal });
        if (!active()) throw Object.assign(new Error('今日风向初始化已取消'), { name: 'AbortError' });
        const initialized = await committer.commitStore(store => {
            const presetId = result.store.scopes[identity.storageId].presetId;
            const previousPreset = store.presets[presetId];
            const currentScope = store.scopes[identity.storageId];
            if ((expectedScopePresetId && currentScope?.presetId !== expectedScopePresetId)
                || JSON.stringify(currentScope || null) !== JSON.stringify(expectedScope)
                || (expectedPresetRevision && previousPreset?.revision !== expectedPresetRevision)
                || (!expectedPresetRevision && previousPreset)) {
                throw new Error('今日风向预设已变化，初始化结果已丢弃');
            }
            const next = structuredClone(store);
            next.presets[presetId] = { ...structuredClone(result.store.presets[presetId]),
                createdAt: previousPreset?.createdAt || result.store.presets[presetId].createdAt,
                revision: previousPreset ? previousPreset.revision + 1 : 1,
                updatedAt: Date.now() };
            next.scopes[identity.storageId] = structuredClone(result.store.scopes[identity.storageId]);
            if (presetName.trim()) next.presets[presetId].name = presetName.trim();
            next.scopes[identity.storageId].operation.enabled = true;
            return next;
        }, { active });
        if (!initialized) throw new Error('今日风向初始化已取消');
        if (!active()) throw Object.assign(new Error('今日风向初始化已取消'), { name: 'AbortError' });
        scheduler.arm(identity.storageId);
        if (initialization === task) initialization = null;
        return initialized;
    };
    const cancelInitialization = reason => {
        initialization?.abortController.abort(reason || 'today-trend-initialization-cancelled');
        initialization = null;
    };
    const cancelRuleRegeneration = reason => {
        ruleRegeneration?.abort(reason || 'today-trend-rule-regeneration-cancelled');
        ruleRegeneration = null;
    };
    const regenerateRule = async rule => {
        const identity = currentIdentity(getStorageId());
        const source = await loadStore(), scope = source.scopes[identity.storageId], preset = source.presets[scope?.presetId];
        if (!scope || !preset) throw new Error('当前聊天尚未初始化今日风向');
        scheduler.cancel('today-trend-rule-regeneration');
        ruleRegeneration?.abort('today-trend-rule-regeneration-replaced');
        const abortController = new AbortController();
        ruleRegeneration = abortController;
        const active = () => ruleRegeneration === abortController && !abortController.signal.aborted && getStorageId() === identity.storageId;
        const text = await controller.regenerateRule({ scope, preset, rule, signal: abortController.signal });
        if (!active()) throw Object.assign(new Error('今日风向规则重生成已取消'), { name: 'AbortError' });
        const committed = await committer.commitStore(store => {
            const current = store.scopes[identity.storageId], currentPreset = store.presets[current?.presetId];
            if (!current || current.presetId !== preset.id || currentPreset?.revision !== preset.revision) throw new Error('今日风向预设已变化，规则重生成结果已丢弃');
            const [group, key = ''] = String(rule).split('-');
            const field = group === 'dynamics' && key ? key : group;
            const rules = group === 'dynamics' && key ? 'dynamicsRules' : 'moduleRules';
            if (!Object.hasOwn(currentPreset[rules], field)) throw new Error('今日风向规则重生成目标无效');
            currentPreset[rules][field] = text;
            currentPreset.revision += 1;
            currentPreset.updatedAt = Date.now();
            return store;
        }, { active });
        if (!committed) throw Object.assign(new Error('今日风向规则重生成已取消'), { name: 'AbortError' });
        if (ruleRegeneration === abortController) ruleRegeneration = null;
        return committed;
    };
    const saveRule = async (rule, text, expectedPresetId, expectedRevision) => {
        const identity = currentIdentity(getStorageId());
        const value = String(text || '').trim();
        const presetId = String(expectedPresetId || '').trim();
        const revision = Number(expectedRevision);
        if (!value) throw new Error('模块规则不能为空');
        if (!presetId) throw new Error('模块规则预设无效');
        if (!Number.isInteger(revision) || revision < 1) throw new Error('模块规则版本无效');
        const committed = await committer.commitStore(store => {
            const scope = store.scopes[identity.storageId], preset = store.presets[scope?.presetId];
            if (!scope || scope.presetId !== presetId || !preset || preset.revision !== revision) throw new Error('今日风向预设已变化，规则保存已丢弃');
            const [group, key = ''] = String(rule).split('-');
            const field = group === 'dynamics' && key ? key : group;
            const rules = group === 'dynamics' && key ? 'dynamicsRules' : 'moduleRules';
            if (!Object.hasOwn(preset[rules], field)) throw new Error('当前模块规则不可用');
            preset[rules][field] = value;
            preset.revision += 1;
            preset.updatedAt = Date.now();
            return store;
        });
        if (!committed) throw new Error('模块规则保存已取消');
        return committed;
    };
    const bindPreset = async (presetId, { start = false } = {}) => {
        const identity = currentIdentity(getStorageId());
        const selected = String(presetId || '').trim();
        const committed = await committer.commitStore(store => {
            if (!store.presets[selected]) throw new Error('选择的世界预设不存在');
            const scope = createEmptyTodayTrendScope();
            scope.operation.enabled = start;
            Object.assign(scope, identity, { presetId: selected });
            store.scopes[identity.storageId] = scope;
            return store;
        });
        if (!committed) throw new Error('世界预设绑定已取消');
        if (start) scheduler.arm(identity.storageId);
        return committed;
    };
    const saveSettings = async ({ presetId, operation, injection } = {}) => {
        const identity = currentIdentity(getStorageId());
        const selected = String(presetId || '').trim();
        const committed = await committer.commitStore(store => {
            const current = store.scopes[identity.storageId];
            if (!current) throw new Error('当前聊天尚未初始化今日风向');
            const next = selected && selected !== current.presetId ? (() => {
                if (!store.presets[selected]) throw new Error('选择的世界预设不存在');
                return Object.assign(createEmptyTodayTrendScope(), identity, { presetId: selected });
            })() : current;
            next.operation = { ...next.operation, ...operation };
            next.injection = { ...next.injection, ...injection };
            store.scopes[identity.storageId] = next;
            return store;
        });
        if (!committed) throw new Error('今日风向设置保存已取消');
        if (operation?.enabled) scheduler.arm(identity.storageId); else scheduler.cancel('today-trend-stopped');
        return committed;
    };
    const renamePreset = async (presetId, name) => {
        const selected = String(presetId || '').trim(), nextName = String(name || '').trim();
        if (!nextName) throw new Error('世界预设名称不能为空');
        const committed = await committer.commitStore(store => {
            const preset = store.presets[selected];
            if (!preset) throw new Error('选择的世界预设不存在');
            preset.name = nextName;
            preset.updatedAt = Date.now();
            preset.revision += 1;
            return store;
        });
        if (!committed) throw new Error('世界预设重命名已取消');
        return committed;
    };
    const deletePreset = async presetId => {
        const selected = String(presetId || '').trim();
        const committed = await committer.commitStore(store => {
            if (!store.presets[selected]) throw new Error('选择的世界预设不存在');
            if (Object.values(store.scopes).some(scope => scope.presetId === selected)) throw new Error('该世界预设仍被角色资料使用，请先切换或重新初始化相关聊天');
            delete store.presets[selected];
            return store;
        });
        if (!committed) throw new Error('世界预设删除已取消');
        return committed;
    };
    Object.assign(deps, {
        getTodayTrendStore: loadStore,
        reloadTodayTrendStore: reloadStore,
        observeTodayTrendTurn: (chat, options) => scheduler.observe(chat, options),
        armTodayTrendGeneration: (storageId, chat) => scheduler.arm(storageId, chat),
        cancelTodayTrendGeneration: (reason, reset) => scheduler.cancel(reason, reset),
        generateTodayTrendModule: (module, itemId, options = {}) => scheduler.run({ kind: 'manual', target: { ...options, module, itemId } }),
        generateTodayTrend: options => scheduler.manual(options),
        getTodayTrendGenerationState: scheduler.state,
        subscribeTodayTrendGeneration: scheduler.subscribe,
        acknowledgeTodayTrendGeneration: scheduler.acknowledge,
        initializeTodayTrend: initialize,
        cancelTodayTrendInitialization: cancelInitialization,
        cancelTodayTrendRuleRegeneration: cancelRuleRegeneration,
        regenerateTodayTrendRule: regenerateRule,
        saveTodayTrendRule: saveRule,
        bindTodayTrendPreset: bindPreset,
        saveTodayTrendSettings: saveSettings,
        renameTodayTrendPreset: renamePreset,
        deleteTodayTrendPreset: deletePreset,
        commitTodayTrendScope: (storageId, mutate, task, options) => committer.commitScope(storageId, mutate, task, options),
        commitTodayTrendStore: (mutate, task, options) => committer.commitStore(mutate, task, options),
    });
    return { controller, committer, scheduler, loadStore, reloadStore };
}
