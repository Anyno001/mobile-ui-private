import { createTodayTrendCommitter } from './today-trend-commit.js';
import { createTodayTrendGenerationController } from './today-trend-generation.js';
import { countTodayTrendAssistantMessages, createTodayTrendScheduler } from './today-trend-scheduler.js';
import { loadTodayTrendStore, saveTodayTrendStore } from './today-trend-storage.js';
import { createEmptyTodayTrendScope } from './today-trend-model.js';
import {
    buildReadOnlyShadow, normalizeTodayTrendV2Candidate, resolveTodayTrendV2DetailForTarget,
    resolveTodayTrendV2RetentionSettingsState, resolveTodayTrendV2UiScope, saveTodayTrendRetentionSettingsToV2,
    serializeTodayTrendV2ScopeForGeneration, replaceTodayTrendV2ScopeWithInitialization,
} from './today-trend-v2-model.js';

export function installTodayTrend(_state, deps = {}) {
    const { runtime, callAI, getCtx, getLastMessageId, getStorageId } = deps;
    if (!runtime || typeof callAI !== 'function' || typeof getCtx !== 'function' || typeof getLastMessageId !== 'function' || typeof getStorageId !== 'function') {
        throw new TypeError('今日风向安装依赖无效');
    }
    const localRuntime = runtime.todayTrend || (runtime.todayTrend = {});
    const load = deps.loadTodayTrendStore || loadTodayTrendStore;
    const save = deps.saveTodayTrendStore || saveTodayTrendStore;
    const committer = (deps.createTodayTrendCommitter || createTodayTrendCommitter)({
        runtime: localRuntime,
        load,
        save,
        refreshInjection: deps.applyBidirectionalInjection,
        prepareInjection: deps.prepareBidirectionalInjection,
    });
    const ensureReady = async () => {
        try {
            if (typeof committer.ready === 'function') await committer.ready();
            if (committer.isBlocked?.()) {
                const error = new Error('Today Trend 存在 blocked 恢复事务，拒绝读取或生成');
                error.code = 'TT_TRANSACTION_BLOCKED';
                throw error;
            }
            delete localRuntime.recoveryError;
        } catch (error) {
            localRuntime.recoveryError = error;
            throw error;
        }
    };
    const loadStore = async ({ force = false } = {}) => {
        await ensureReady();
        if (!force && localRuntime.store) return localRuntime.store;
        const loaded = await load();
        localRuntime.store = loaded;
        return loaded;
    };
    if (typeof committer.ready === 'function') {
        ensureReady().catch(() => {});
    }
    const controller = (deps.createTodayTrendGenerationController || createTodayTrendGenerationController)({ callAI, getCtx });
    const getHostFloor = () => {
        try {
            const rawFloor = getLastMessageId();
            if (rawFloor === null || rawFloor === undefined || (typeof rawFloor === 'string' && !rawFloor.trim())) return null;
            const floor = Number(rawFloor);
            return Number.isInteger(floor) && floor >= 0 ? floor : null;
        } catch {
            return null;
        }
    };
    const scheduler = createTodayTrendScheduler({ controller, committer, getStore: loadStore, getStorageId,
        getChat: () => getCtx()?.chat || [], getFloor: getHostFloor, getCalendarStore: deps.getCalendarStore,
        getPromptScope: typeof committer.loadCanonical === 'function' ? async (storageId, canonicalOverride = null) =>
            serializeTodayTrendV2ScopeForGeneration(
                canonicalOverride || await committer.loadCanonical(), storageId,
            ) : null });
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
    const initialize = async ({ worldBookNames, includeExistingChat = true, backfillExistingChat = false,
        recentAssistantCount, mergeAssistantCount, runBackfill = false, userRequirements = '', presetName = '', presetId = '', signal } = {}) => {
        const identity = currentIdentity(getStorageId());
        const existing = await loadStore();
        const assistantCount = countTodayTrendAssistantMessages(getCtx()?.chat);
        const fallbackMergeAssistantCount = Math.min(5, assistantCount);
        const normalizedRecentAssistantCount = backfillExistingChat === true && assistantCount > 0
            ? (recentAssistantCount === undefined ? assistantCount : recentAssistantCount) : null;
        const normalizedMergeAssistantCount = backfillExistingChat === true && assistantCount > 0
            ? (mergeAssistantCount === undefined ? fallbackMergeAssistantCount : mergeAssistantCount) : null;
        if (backfillExistingChat === true && assistantCount > 0
            && (!Number.isSafeInteger(normalizedRecentAssistantCount) || normalizedRecentAssistantCount < 1
                || normalizedRecentAssistantCount > assistantCount)) {
            throw Object.assign(new Error('初始化历史回填 recentAssistantCount 越界'), { code: 'TT_HISTORY_WINDOW_INVALID' });
        }
        if (backfillExistingChat === true && assistantCount > 0
            && (!Number.isSafeInteger(normalizedMergeAssistantCount) || normalizedMergeAssistantCount < 1
                || normalizedMergeAssistantCount > normalizedRecentAssistantCount)) {
            throw Object.assign(new Error('初始化历史回填 mergeAssistantCount 越界'), { code: 'TT_HISTORY_WINDOW_INVALID' });
        }
        const initializationBatchDraft = normalizedRecentAssistantCount === null ? null : {
            enabled: true, recentAssistantCount: normalizedRecentAssistantCount, mergeAssistantCount: normalizedMergeAssistantCount,
        };
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
        const canonicalAtStart = committer.supportsCanonical === true && typeof committer.loadCanonical === 'function'
            ? await committer.loadCanonical() : null;
        const expectedCanonicalScopeRevision = canonicalAtStart?.globalEnvelope?.payload?.scopes?.[identity.storageId]?.revision;
        const result = await controller.initialize({ ...identity, worldBookNames, includeExistingChat, userRequirements,
            presetId: resolvedPresetId, signal: task.abortController.signal });
        if (!active()) throw Object.assign(new Error('今日风向初始化已取消'), { name: 'AbortError' });
        const initialized = canonicalAtStart
            ? await committer.commitStore(store => {
                const currentFacade = buildReadOnlyShadow(store);
                const currentScope = currentFacade.scopes[identity.storageId];
                const previousPreset = currentFacade.presets[resolvedPresetId];
                if ((expectedScopePresetId && currentScope?.presetId !== expectedScopePresetId)
                    || JSON.stringify(currentScope || null) !== JSON.stringify(expectedScope)
                    || (expectedPresetRevision && previousPreset?.revision !== expectedPresetRevision)
                    || (!expectedPresetRevision && previousPreset)) throw new Error('今日风向预设已变化，初始化结果已丢弃');
                const initializationStore = structuredClone(result.store);
                const nextPreset = initializationStore.presets[resolvedPresetId];
                nextPreset.createdAt = previousPreset?.createdAt || nextPreset.createdAt;
                nextPreset.revision = previousPreset ? previousPreset.revision + 1 : 1;
                nextPreset.updatedAt = Date.now();
                if (presetName.trim()) nextPreset.name = presetName.trim();
                initializationStore.scopes[identity.storageId].operation = {
                    ...initializationStore.scopes[identity.storageId].operation,
                    enabled: true,
                    ...(initializationBatchDraft ? { batchDraft: initializationBatchDraft } : {}),
                };
                return replaceTodayTrendV2ScopeWithInitialization(store, initializationStore, identity.storageId, Date.now());
            }, { active }, {
                canonical: true,
                scopeId: identity.storageId,
                expectedStoreRevision: canonicalAtStart.globalEnvelope.revision,
                ...(expectedCanonicalScopeRevision === undefined ? {} : { expectedScopeRevision: expectedCanonicalScopeRevision }),
            })
            : await committer.commitStore(store => {
                const previousPreset = store.presets[resolvedPresetId];
                const currentScope = store.scopes[identity.storageId];
                if ((expectedScopePresetId && currentScope?.presetId !== expectedScopePresetId)
                    || JSON.stringify(currentScope || null) !== JSON.stringify(expectedScope)
                    || (expectedPresetRevision && previousPreset?.revision !== expectedPresetRevision)
                    || (!expectedPresetRevision && previousPreset)) throw new Error('今日风向预设已变化，初始化结果已丢弃');
                const next = structuredClone(store);
                next.presets[resolvedPresetId] = { ...structuredClone(result.store.presets[resolvedPresetId]),
                    createdAt: previousPreset?.createdAt || result.store.presets[resolvedPresetId].createdAt,
                    revision: previousPreset ? previousPreset.revision + 1 : 1, updatedAt: Date.now() };
                next.scopes[identity.storageId] = structuredClone(result.store.scopes[identity.storageId]);
                if (presetName.trim()) next.presets[resolvedPresetId].name = presetName.trim();
                next.scopes[identity.storageId].operation = {
                    ...next.scopes[identity.storageId].operation,
                    enabled: true,
                    ...(initializationBatchDraft ? { batchDraft: initializationBatchDraft } : {}),
                };
                return next;
            }, { active });
        if (!initialized) throw new Error('今日风向初始化已取消');
        if (!active()) throw Object.assign(new Error('今日风向初始化已取消'), { name: 'AbortError' });
        scheduler.arm(identity.storageId);
        if (runBackfill === true && initializationBatchDraft) await scheduler.manual({ batchEnabled: true, ...initializationBatchDraft });
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
        if (typeof committer.loadCanonical !== 'function') throw Object.assign(new Error('今日风向设置需要 canonical 存储能力'), { code: 'TT_V2_CANONICAL_REQUIRED' });
        const canonical = await committer.loadCanonical();
        const currentEnvelope = canonical?.globalEnvelope?.payload?.scopes?.[identity.storageId];
        if (!currentEnvelope?.payload) throw Object.assign(new Error('当前聊天尚未初始化今日风向'), { code: 'TT_V2_SCHEMA_INVALID' });
        if (selected && selected !== currentEnvelope.payload.presetId) {
            const committed = await committer.commitStore(store => {
                const facade = buildReadOnlyShadow(store);
                const current = facade.scopes[identity.storageId];
                if (!current) throw new Error('当前聊天尚未初始化今日风向');
                if (!facade.presets[selected]) throw new Error('选择的世界预设不存在');
                const next = Object.assign(createEmptyTodayTrendScope(), identity, { presetId: selected });
                next.operation = { ...next.operation, ...operation };
                next.injection = { ...next.injection, ...injection };
                facade.scopes[identity.storageId] = next;
                return normalizeTodayTrendV2Candidate(facade, store);
            }, null, { canonical: true, scopeId: identity.storageId, expectedScopeRevision: currentEnvelope.revision });
            if (!committed) throw new Error('今日风向设置保存已取消');
            if (operation?.enabled) scheduler.arm(identity.storageId); else scheduler.cancel('today-trend-stopped');
            return committed;
        }
        const committed = await committer.commitStore(store => {
            const scopes = store.globalEnvelope.payload.scopes;
            const envelope = scopes[identity.storageId];
            if (!envelope?.payload) throw Object.assign(new Error('当前聊天尚未初始化今日风向'), { code: 'TT_V2_SCHEMA_INVALID' });
            const current = envelope.payload;
            scopes[identity.storageId] = { ...envelope, payload: {
                ...current,
                operation: { ...current.operation, ...operation },
                injection: { ...current.injection, ...injection },
            } };
            return store;
        }, null, { canonical: true, scopeId: identity.storageId, expectedScopeRevision: currentEnvelope.revision });
        if (!committed) throw new Error('今日风向设置保存已取消');
        if (operation?.enabled) scheduler.arm(identity.storageId); else scheduler.cancel('today-trend-stopped');
        return committed;
    };
    const retentionSettingsState = async storageId => {
        if (typeof committer.loadCanonical !== 'function') return null;
        return resolveTodayTrendV2RetentionSettingsState(await committer.loadCanonical(), storageId);
    };
    const saveRetentionSettings = async ({
        storageId, archivedDetailLatestEventCount, archivedDetailRetentionFloors,
        expectedScopeRevision, expectedSettingsRevision,
    } = {}) => {
        const identity = currentIdentity(String(storageId || ''));
        if (typeof committer.loadCanonical !== 'function') {
            throw Object.assign(new Error('归档保留设置需要 canonical 存储能力'), { code: 'TT_V2_CANONICAL_REQUIRED' });
        }
        const committed = await committer.commitStore(current => saveTodayTrendRetentionSettingsToV2(
            current,
            identity.storageId,
            { archivedDetailLatestEventCount, archivedDetailRetentionFloors },
            { expectedScopeRevision, expectedSettingsRevision },
        ), null, { canonical: true, scopeId: identity.storageId });
        if (!committed) throw Object.assign(new Error('归档保留设置保存已取消'), { name: 'AbortError' });
        const canonical = await committer.loadCanonical();
        const scope = resolveTodayTrendV2UiScope(canonical, identity.storageId);
        const revisions = resolveTodayTrendV2RetentionSettingsState(canonical, identity.storageId);
        if (!scope || !revisions) {
            throw Object.assign(new Error('归档保留设置保存后无法重新读取 committed scope'), { code: 'TT_V2_SCHEMA_INVALID' });
        }
        return { scope, revisions };
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
        getTodayTrendUiScope: async storageId => {
            if (typeof committer.loadCanonical !== 'function') return (await loadStore()).scopes?.[storageId] || null;
            return resolveTodayTrendV2UiScope(await committer.loadCanonical(), storageId);
        },
        getTodayTrendRetentionSettingsState: retentionSettingsState,
        reloadTodayTrendStore: reloadStore,
        resolveTodayTrendDetail: async (eventId, detailId, targetAssistantCount = getHostFloor()) => {
            if (typeof committer.loadCanonical !== 'function' || targetAssistantCount === null) return null;
            return resolveTodayTrendV2DetailForTarget(
                await committer.loadCanonical(), getStorageId(), eventId, detailId, targetAssistantCount,
            );
        },
        observeTodayTrendTurn: (chat, options) => scheduler.observe(chat, options),
        armTodayTrendGeneration: (storageId, chat) => scheduler.arm(storageId, chat),
        cancelTodayTrendGeneration: (reason, reset) => scheduler.cancel(reason, reset),
        generateTodayTrendModule: (module, itemId, options = {}) => scheduler.run({ kind: 'manual', target: { ...options, module, itemId } }),
        generateTodayTrend: options => scheduler.manual(options),
        getTodayTrendCurrentFloor: getHostFloor,
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
        saveTodayTrendRetentionSettings: saveRetentionSettings,
        renameTodayTrendPreset: renamePreset,
        deleteTodayTrendPreset: deletePreset,
        commitTodayTrendScope: (storageId, mutate, task, options) => committer.commitScope(storageId, mutate, task, options),
        commitTodayTrendStore: (mutate, task, options) => committer.commitStore(mutate, task, options),
    });
    return { controller, committer, scheduler, loadStore, reloadStore };
}
