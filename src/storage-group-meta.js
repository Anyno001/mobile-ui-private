import { normalizeGroupMetaStore } from './behavior-config.js';
import { enqueueDirectorySave } from './directory-save-coordinator.js';
import { pmIDBGet, pmIDBSet } from './storage-primitives.js';

const GROUP_META_STORE_KEY = 'ST_SMS_GROUP_META';
const GROUP_META_FALLBACK_KEY = `${GROUP_META_STORE_KEY}_LOCAL_FALLBACK`;

export async function loadGroupMeta() {
    try {
        const fallback = localStorage.getItem(GROUP_META_FALLBACK_KEY);
        if (fallback) {
            window.__pmGroupMeta = normalizeGroupMetaStore(JSON.parse(fallback) || {});
            return window.__pmGroupMeta;
        }
    } catch (error) {
        try { localStorage.removeItem(GROUP_META_FALLBACK_KEY); } catch (removeError) {}
    }
    const value = await pmIDBGet(GROUP_META_STORE_KEY);
    if (value && typeof value === 'object') {
        window.__pmGroupMeta = normalizeGroupMetaStore(value);
        return window.__pmGroupMeta;
    }
    try { window.__pmGroupMeta = normalizeGroupMetaStore(JSON.parse(localStorage.getItem(GROUP_META_STORE_KEY)) || {}); }
    catch (error) { window.__pmGroupMeta = {}; }
    return window.__pmGroupMeta;
}

export async function saveGroupMeta(data) {
    const { coordinated = false } = arguments[1] || {};
    const updatesGlobalState = arguments.length === 0;
    const snapshot = normalizeGroupMetaStore(updatesGlobalState ? window.__pmGroupMeta : data);
    if (updatesGlobalState) window.__pmGroupMeta = snapshot;
    const persist = async (frozen, protectedScopes = []) => {
        let value = frozen;
        if (protectedScopes.length) {
            const current = await pmIDBGet(GROUP_META_STORE_KEY);
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                value = normalizeGroupMetaStore(frozen);
                for (const scope of protectedScopes) {
                    if (Object.hasOwn(current, scope)) value[scope] = structuredClone(current[scope]);
                    else delete value[scope];
                }
            }
        }
        if (await pmIDBSet(GROUP_META_STORE_KEY, value)) {
            try { localStorage.setItem(GROUP_META_STORE_KEY, JSON.stringify(value)); } catch (error) {}
            try { localStorage.removeItem(GROUP_META_FALLBACK_KEY); } catch (error) {}
        } else {
            try { localStorage.setItem(GROUP_META_FALLBACK_KEY, JSON.stringify(value)); }
            catch { throw new Error('群聊配置保存失败：浏览器存储不可用或空间不足'); }
        }
        return value;
    };
    if (coordinated) return persist(structuredClone(snapshot));
    return enqueueDirectorySave('groupMeta', snapshot, (frozen, protectedScopes) => persist(frozen, protectedScopes), updatesGlobalState);
}
