import { normalizeInteractiveStore, stripPersistedV2ContentRating } from './interactive-scene-model.js';

export const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const now = () => Date.now();
const cloneStore = store => normalizeInteractiveStore(JSON.parse(JSON.stringify(store)));
const canonicalIdentityName = value => String(value ?? '').trim().slice(0, 80).toLocaleLowerCase();

export function parseCommunityPostInput(rawContent, _actors, defaultAuthorSeed, options = {}) {
    const identityMatch = String(rawContent || '').match(/^【([^】]+)】/);
    const identityName = identityMatch?.[1].trim().slice(0, 80);
    const content = (identityMatch ? String(rawContent).slice(identityMatch[0].length) : String(rawContent || '')).trim();
    const contentLabel = options.contentLabel === '评论' ? '评论' : '帖子';
    const maxLength = Number.isInteger(options.maxLength) && options.maxLength > 0 ? options.maxLength : 4000;
    if (!content) throw new Error(`${contentLabel}内容不能为空`);
    if (content.length > maxLength) throw new Error(`${contentLabel}内容不能超过 ${maxLength} 字`);
    if (!identityName) return { authorSeed: defaultAuthorSeed, content };
    return {
        authorSeed: {
            type: 'passerby',
            displayName: identityName,
            bindingKey: `manual:${canonicalIdentityName(identityName)}`,
            profile: '',
        },
        content,
    };
}

export async function migrateInteractiveStore(rawStore, saveStore) {
    const persistedCompatibility = stripPersistedV2ContentRating(rawStore);
    const normalized = normalizeInteractiveStore(persistedCompatibility.store);
    const needsSave = !!rawStore && (rawStore.version !== normalized.version || persistedCompatibility.changed);
    if (!needsSave) return normalized;
    const snapshot = JSON.parse(JSON.stringify(rawStore));
    try {
        await saveStore(normalized);
    } catch (error) {
        try {
            await saveStore(snapshot);
        } catch (rollbackError) {
            const combined = new Error(`${error.message}；互动场景迁移回滚也失败：${rollbackError.message}`);
            combined.cause = error;
            combined.rollbackError = rollbackError;
            throw combined;
        }
        throw error;
    }
    return normalized;
}

export function createInteractiveOperationGuard({ getEpoch, getStorageId, getOpenSceneId, isMounted }, { epoch, storageId, sceneId }) {
    if (![getEpoch, getStorageId, getOpenSceneId, isMounted].every(value => typeof value === 'function')) {
        throw new TypeError('社区操作有效性依赖无效');
    }
    return () => {
        const expectedSceneId = typeof sceneId === 'function' ? sceneId() : sceneId;
        return getEpoch() === epoch
            && getStorageId() === storageId
            && (!expectedSceneId || getOpenSceneId() === expectedSceneId)
            && isMounted();
    };
}

export function createInteractiveCommitQueue({ getStore, setStore, saveStore, syncStore = null }) {
    if (syncStore !== null && typeof syncStore !== 'function') throw new TypeError('互动场景同步依赖无效');
    let queue = Promise.resolve();
    const commit = (mutator, isValid = null, context = '操作') => {
        const operation = queue.catch(() => {}).then(async () => {
            const snapshot = cloneStore(getStore());
            const cancelled = () => new Error(context === '操作' ? '文字直播已停止' : `${context}已取消`);
            if (isValid && !isValid()) throw cancelled();
            let result;
            try {
                result = await mutator();
            } catch (error) {
                setStore(snapshot);
                throw error;
            }
            let failure = null;
            try {
                await saveStore(normalizeInteractiveStore(getStore()));
                await syncStore?.();
                if (isValid && !isValid()) throw cancelled();
                return result;
            } catch (error) {
                failure = error;
            }
            setStore(snapshot);
            try {
                await saveStore(snapshot);
                await syncStore?.();
            } catch (compensationError) {
                const combined = new Error(`${failure.message}；补偿持久化或同步也失败：${compensationError.message}`);
                combined.cause = failure;
                combined.rollbackError = compensationError;
                throw combined;
            }
            throw failure;
        });
        queue = operation;
        return operation;
    };
    return commit;
}


export function createInteractiveStoreLoader({ runtime, load, migrate }) {
    if (!runtime || typeof load !== 'function' || typeof migrate !== 'function') {
        throw new TypeError('互动场景加载器依赖无效');
    }
    if (!Number.isInteger(runtime.loadGeneration)) runtime.loadGeneration = 0;
    const loadStore = async () => {
        if (runtime.store) return runtime.store;
        if (!runtime.loadPromise) {
            const generation = runtime.loadGeneration;
            runtime.loadPromise = {
                generation,
                promise: Promise.resolve().then(load).then(migrate),
            };
        }
        const pending = runtime.loadPromise;
        try {
            let loaded;
            try {
                loaded = await pending.promise;
            } catch (error) {
                if (pending.generation !== runtime.loadGeneration) return loadStore();
                throw error;
            }
            if (pending.generation !== runtime.loadGeneration) return loadStore();
            runtime.store = loaded;
            return loaded;
        } finally {
            if (runtime.loadPromise === pending) runtime.loadPromise = null;
        }
    };
    const invalidateStore = () => {
        runtime.loadGeneration += 1;
        runtime.store = null;
        runtime.loadPromise = null;
    };
    return { loadStore, invalidateStore };
}
