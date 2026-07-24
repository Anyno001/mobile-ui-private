import { savePokeConfig } from './storage.js';

// 自动消息配置：enabled + probability（百分比 0-100，整数）+ counter（0/1 抽签旗标）
const DEFAULT_AUTO_POKE = Object.freeze({ enabled: false, probability: 30, counter: 0 });
const clone = value => JSON.parse(JSON.stringify(value));

const clampProbability = raw => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return DEFAULT_AUTO_POKE.probability;
    return Math.max(0, Math.min(100, Math.round(num)));
};

// 兼容旧字段 interval（"每 N 轮触发一次"）：折算为概率，round(100/N)。
// 仅在新字段 probability 缺失时使用，读后落盘即升级；旧字段不再写出。
const migrateIntervalToProbability = interval => {
    const num = Number.parseInt(interval, 10);
    if (!Number.isFinite(num) || num <= 0) return DEFAULT_AUTO_POKE.probability;
    return clampProbability(100 / num);
};

const normalizeCounter = value => (value === 1 ? 1 : 0);

export function normalizeAutoPoke(value) {
    const counter = normalizeCounter(value?.counter);
    const probability = value?.probability != null
        ? clampProbability(value.probability)
        : migrateIntervalToProbability(value?.interval);
    return {
        enabled: value?.enabled === true,
        probability,
        counter,
    };
}

export function getAutoPokeConfig(storageId, targetKey) {
    return normalizeAutoPoke(window.__pmPokeConfig?.[storageId]?.[targetKey]?.autoPoke);
}

export function commitAutoPokeConfig(storageId, targetKey, patch, persist = savePokeConfig) {
    if (!storageId || !targetKey) return false;
    const storageConfig = window.__pmPokeConfig?.[storageId];
    const hadStorage = Boolean(storageConfig);
    const hadTarget = Boolean(storageConfig && Object.prototype.hasOwnProperty.call(storageConfig, targetKey));
    const snapshot = hadTarget ? clone(storageConfig[targetKey]) : null;
    if (!window.__pmPokeConfig) window.__pmPokeConfig = {};
    if (!window.__pmPokeConfig[storageId]) window.__pmPokeConfig[storageId] = {};
    const previous = window.__pmPokeConfig[storageId][targetKey] || {};
    const nextAutoPoke = normalizeAutoPoke({ ...previous.autoPoke, ...patch });
    // probability 模型下 counter 是 0/1 二值旗标：切换启用时清掉残留旗标，避免上一轮抽签"复活"
    if (nextAutoPoke.enabled && patch?.enabled === true) nextAutoPoke.counter = 0;
    window.__pmPokeConfig[storageId][targetKey] = {
        ...previous,
        autoPoke: nextAutoPoke,
    };
    let persisted = false;
    try {
        persisted = persist() === true;
    } catch (error) {
        persisted = false;
    }
    if (persisted) return true;
    if (hadTarget) window.__pmPokeConfig[storageId][targetKey] = snapshot;
    else delete window.__pmPokeConfig[storageId][targetKey];
    if (!hadStorage && !Object.keys(window.__pmPokeConfig[storageId]).length) delete window.__pmPokeConfig[storageId];
    return false;
}

export function resetAutoPokeCounter(storageId, targetKey, persist = savePokeConfig) {
    if (!window.__pmPokeConfig?.[storageId]
        || !Object.prototype.hasOwnProperty.call(window.__pmPokeConfig[storageId], targetKey)) return true;
    return commitAutoPokeConfig(storageId, targetKey, { counter: 0 }, persist);
}
