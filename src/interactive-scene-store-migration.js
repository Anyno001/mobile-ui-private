const assertDataObject = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} 必须是纯数据对象`);
    if (Object.getOwnPropertySymbols(value).length) throw new Error(`${label} 不能包含 symbol 字段`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const accessor = Object.entries(descriptors).find(([, descriptor]) => !Object.hasOwn(descriptor, 'value'));
    if (accessor) throw new Error(`${label}.${accessor[0]} 不能是访问器属性`);
    const hidden = Object.entries(descriptors).find(([, descriptor]) => descriptor.enumerable !== true);
    if (hidden) throw new Error(`${label}.${hidden[0]} 必须是可枚举属性`);
};

export function stripPersistedV2ContentRating(rawStore, storeVersion) {
    if (rawStore === null || rawStore === undefined || typeof rawStore !== 'object' || Array.isArray(rawStore)) return { store: rawStore, changed: false };
    assertDataObject(rawStore, '互动场景持久化 store');
    if (rawStore.version !== storeVersion) return { store: rawStore, changed: false };
    assertDataObject(rawStore.scopes, '互动场景持久化 scopes');
    let changed = false;
    const scopes = { ...rawStore.scopes };
    for (const [scopeId, rawScope] of Object.entries(rawStore.scopes)) {
        assertDataObject(rawScope, `互动场景持久化 scope ${scopeId}`);
        assertDataObject(rawScope.scenes, `互动场景持久化 scope ${scopeId}.scenes`);
        let scenes = rawScope.scenes;
        for (const [sceneId, rawScene] of Object.entries(rawScope.scenes)) {
            assertDataObject(rawScene, `互动场景持久化 scope ${scopeId}.scene ${sceneId}`);
            const ratingDescriptor = Object.getOwnPropertyDescriptor(rawScene, 'contentRating');
            if (!ratingDescriptor || ratingDescriptor.enumerable !== true || typeof ratingDescriptor.value !== 'string') continue;
            if (scenes === rawScope.scenes) scenes = { ...rawScope.scenes };
            const scene = { ...rawScene };
            delete scene.contentRating;
            scenes[sceneId] = scene;
            changed = true;
        }
        if (scenes !== rawScope.scenes) scopes[scopeId] = { ...rawScope, scenes };
    }
    return { store: changed ? { ...rawStore, scopes } : rawStore, changed };
}
