const text = (value, max) => String(value ?? '').trim().slice(0, max);
const finitePositiveNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
};
const isUnsafeDictionaryKey = value => value === 'prototype' || Object.hasOwn(Object.prototype, value);
const validPhoneUiId = (value, max) => typeof value === 'string' && value && value === value.trim() && value.length <= max && !isUnsafeDictionaryKey(value);
const normalizeThemeAccent = value => {
    const accent = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(accent) ? accent.toLowerCase() : '';
};
const stableHash = value => {
    let hash = 2166136261;
    for (const character of String(value)) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};
const normalizeCommunityTemplate = value => {
    const sourceStorageId = value?.sourceStorageId;
    const sourceSceneId = value?.sourceSceneId;
    const templateId = value?.id;
    const title = text(value?.title, 80);
    const preset = text(value?.preset, 30);
    if (!validPhoneUiId(templateId, 120) || !validPhoneUiId(sourceStorageId, 160) || !validPhoneUiId(sourceSceneId, 80) || !title || !preset) return null;
    const sharedAt = finitePositiveNumber(value?.sharedAt);
    if (!sharedAt) return null;
    return { id: templateId, sourceStorageId, sourceSceneId, title, preset, styleInput: text(value?.styleInput, 2000), generatedPrompt: text(value?.generatedPrompt, 6000), themeAccent: normalizeThemeAccent(value?.themeAccent), sharedAt };
};

export { validPhoneUiId };
export const normalizeSharedCommunityTemplates = value => {
    const templates = new Map();
    for (const raw of Array.isArray(value) ? value : []) {
        const template = normalizeCommunityTemplate(raw);
        if (template) templates.set(template.id, template);
    }
    return [...templates.values()];
};
export const normalizeImportedTemplateSceneIds = (value, scenes) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    for (const [templateId, sceneId] of Object.entries(value)) {
        if (validPhoneUiId(templateId, 120) && validPhoneUiId(sceneId, 80) && Object.hasOwn(scenes || {}, sceneId)) result[templateId] = sceneId;
    }
    return result;
};
export function createCommunityTemplate(scene, sourceStorageId, sharedAt = Date.now()) {
    if (!scene || !validPhoneUiId(sourceStorageId, 160) || !validPhoneUiId(scene.id, 80)) throw new Error('社区模板来源无效');
    const timestamp = finitePositiveNumber(sharedAt);
    if (!timestamp) throw new Error('社区模板时间无效');
    return { id: `template_${stableHash(`${sourceStorageId}\u0000${scene.id}`)}`, sourceStorageId, sourceSceneId: scene.id, title: text(scene.title, 80) || '未命名互动场景', preset: text(scene.preset, 30) || 'weibo', styleInput: text(scene.styleInput, 2000), generatedPrompt: text(scene.generatedPrompt, 6000), themeAccent: normalizeThemeAccent(scene.themeAccent), sharedAt: timestamp };
}
export function createSceneFromCommunityTemplate(template, sceneId, createdAt = Date.now()) {
    const normalized = normalizeCommunityTemplate(template);
    const timestamp = finitePositiveNumber(createdAt);
    if (!normalized || !validPhoneUiId(sceneId, 80) || !timestamp) throw new Error('社区模板无效');
    return { id: sceneId, title: normalized.title, preset: normalized.preset, styleInput: normalized.styleInput, generatedPrompt: normalized.generatedPrompt, themeAccent: normalized.themeAccent, createdAt: timestamp, updatedAt: timestamp, posts: [], live: { title: '', status: 'idle', warmupStarted: false, danmaku: [] } };
}
