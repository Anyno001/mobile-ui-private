import { savePokeConfig } from './storage.js';

const DEFAULT_AUTO_POKE = Object.freeze({ enabled: false, interval: 3, counter: 0 });
const clone = value => JSON.parse(JSON.stringify(value));

export function normalizeAutoPoke(value) {
    const interval = Math.max(1, Math.min(99, Number.parseInt(value?.interval, 10) || DEFAULT_AUTO_POKE.interval));
    const counter = Math.max(0, Number.parseInt(value?.counter, 10) || 0);
    return {
        enabled: value?.enabled === true,
        interval,
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
    if (nextAutoPoke.enabled) nextAutoPoke.counter = Math.min(nextAutoPoke.counter, nextAutoPoke.interval);
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
