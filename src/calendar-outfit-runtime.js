import { normalizeOutfitStore, outfitSubjectKeys } from './calendar-outfit-model.js';
import { loadCalendarOutfits } from './calendar-storage.js';

export const loadOutfitStore = () => normalizeOutfitStore(loadCalendarOutfits());

export function outfitSubjectOptions(state, store, storageId) {
    const names = state.isGroupChat ? state.groupMembers : [state.currentPersona];
    const ids = [...names.filter(Boolean).map(name => `role:${name}`), ...outfitSubjectKeys(store, storageId)];
    const seen = new Set();
    return ids.flatMap(value => {
        if (!value || seen.has(value)) return [];
        seen.add(value);
        return [{ value, label: value.startsWith('role:') ? value.slice(5) : value }];
    });
}

export function handleOutfitPageAction({ button, app, storageId, state, runtime, viewFor, rerender, outfitController }) {
    const action = button.dataset.action;
    if (action === 'calendar-outfit-subject') {
        const current = viewFor(storageId);
        runtime.viewByStorage.set(storageId, { ...current, outfitSubject: button.value || `role:${state.currentPersona || '角色'}` });
        rerender(storageId);
        return true;
    }
    if (action === 'calendar-outfit-worldbook-columns') {
        return Promise.resolve(globalThis.window?.__pmShowWorldBookColumns?.({
            title: '穿搭数据来源', module: 'outfit',
            backAction: 'window.__pmReturnToCalendarDataSource()', backLabel: '返回日历',
        })).then(() => true);
    }
    if (!action.startsWith('calendar-outfit-')) return false;
    return Promise.resolve(outfitController.handleAction(button, app, storageId)).then(handled => {
        if (!handled) throw new Error(`未知穿搭操作：${action}`);
        return true;
    });
}
