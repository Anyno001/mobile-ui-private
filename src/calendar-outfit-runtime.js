import { normalizeOutfitStore, OUTFIT_SELF_SUBJECT, outfitScopeFor, outfitSubjectKeys, outfitSubjectLabel, renderOutfitInjection } from './calendar-outfit-model.js';
import { loadCalendarOutfits } from './calendar-storage.js';

export const loadOutfitStore = () => normalizeOutfitStore(loadCalendarOutfits());

export function outfitSubjectOptions(state, store, storageId, userName = '') {
    const names = state.isGroupChat ? state.groupMembers : [state.currentPersona];
    const ids = [OUTFIT_SELF_SUBJECT, ...names.filter(Boolean).map(name => `role:${name}`), ...outfitSubjectKeys(store, storageId)];
    const seen = new Set();
    return ids.flatMap(value => {
        if (!value || seen.has(value)) return [];
        seen.add(value);
        const label = outfitSubjectLabel(value, userName);
        return label ? [{ value, label }] : [];
    });
}

// 手机短信回复用：用户与当前联系人/群成员在故事日期前后一天的穿搭，受日历「穿搭注入」开关控制。
export function renderPhoneOutfitPrompt({ store, storageId, enabled, start, names = [], userName = '' }) {
    if (!enabled || !storageId) return '';
    const subjects = [[OUTFIT_SELF_SUBJECT, OUTFIT_SELF_SUBJECT], ...[...new Set(names.map(name => String(name || '').trim()).filter(Boolean))].map(name => [`role:${name}`, name])];
    const blocks = subjects.flatMap(([subject, label]) => {
        const body = renderOutfitInjection(outfitScopeFor(store, storageId, subject), { start, subject: label, userName: subject === OUTFIT_SELF_SUBJECT ? userName : '' });
        return body ? [body] : [];
    });
    return blocks.length ? `\n\n【当日穿搭】（仅在相关时自然提及，不必每条复述）\n${blocks.join('\n')}` : '';
}

export function handleOutfitPageAction({ button, app, storageId, state, runtime, viewFor, rerender, outfitController }) {
    const action = button.dataset.action;
    if (action === 'calendar-outfit-subject') {
        const current = viewFor(storageId);
        runtime.viewByStorage.set(storageId, { ...current, outfitSubject: button.value || OUTFIT_SELF_SUBJECT });
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
