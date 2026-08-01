import { advanceTodayTrendEvent, archiveTodayTrendEvent, promoteTodayTrendUnderground, settleTodayTrendRumor } from './today-trend-model.js';

const newId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const replaceOrAppend = (records, record) => records.some(item => item.id === record.id) ? records.map(item => item.id === record.id ? record : item) : [...records, record];

function formValue(form, name) {
    return String(new FormData(form).get(name) || '').trim();
}

function readWorldItem(form) {
    return { id: formValue(form, 'id') || newId('world'), name: formValue(form, 'name'), summary: formValue(form, 'summary') };
}

function readCircle(form) {
    return { id: formValue(form, 'id') || newId('circle'), name: formValue(form, 'name'), scope: formValue(form, 'scope') };
}

function readFaction(form) {
    const data = new FormData(form);
    const labels = data.getAll('detailLabel').map(value => String(value).trim());
    const values = data.getAll('detailValue').map(value => String(value).trim());
    return {
        id: String(data.get('id') || '').trim() || newId('faction'), name: String(data.get('name') || '').trim(),
        summary: String(data.get('summary') || '').trim(), parentId: String(data.get('parentId') || '').trim() || null,
        relatedFactionIds: data.getAll('relatedFactionIds').map(value => String(value)),
        details: labels.map((label, index) => ({ label, value: values[index] || '' })),
        relation: { status: String(data.get('status') || ''), evaluation: String(data.get('evaluation') || '').trim() },
    };
}

function readEvent(form, existing = null) {
    const data = new FormData(form);
    const stage = String(data.get('latestStage') || '').trim();
    return {
        id: String(data.get('id') || '').trim() || newId('event'), type: String(data.get('type') || existing?.type || 'normal'),
        lifecycle: 'active', title: String(data.get('title') || '').trim(), stageLabel: String(data.get('stageLabel') || '').trim(),
        origin: String(data.get('origin') || '').trim(), participants: String(data.get('participants') || '').split(/[、,，]/).map(value => value.trim()).filter(Boolean),
        stages: existing?.stages || [stage], latestStage: stage, outcome: null, finalResult: null,
        relatedEventIds: existing?.relatedEventIds || [], createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
    };
}

export function createTodayTrendActionDispatcher({
    container, getStorageId, getStore, committer, render, onGenerate, onRefresh, onEditRule, onError = () => {}, onStatus = () => {},
} = {}) {
    if (!container?.addEventListener || typeof getStorageId !== 'function' || typeof getStore !== 'function' || typeof committer?.commitScope !== 'function' || typeof render !== 'function') {
        throw new TypeError('今日风向动作分发依赖无效');
    }
    const view = { name: 'world', mode: 'content', editingWorldItemId: null, editingCircleId: null, editingFactionId: null, editingEventId: null };
    const rerender = async () => render({ ...view, store: await getStore(), storageId: getStorageId() });
    const commit = async mutate => {
        const storageId = String(getStorageId() || '').trim();
        if (!storageId) throw new Error('当前聊天缺少有效资料 ID');
        const result = await committer.commitScope(storageId, mutate);
        if (!result) throw new Error('今日风向资料未提交');
        await rerender();
        return result;
    };
    const run = promise => Promise.resolve(promise).catch(error => { onError(error); return false; });
    const open = (name, mode = 'content') => { view.name = name; view.mode = mode; view.editingWorldItemId = null; view.editingCircleId = null; view.editingFactionId = null; view.editingEventId = null; return rerender(); };
    const click = event => {
        const button = event.target.closest?.('button[data-action]');
        if (!button || !container.contains(button) || button.disabled) return;
        const action = button.dataset.action;
        if (action === 'today-trend-add-detail') {
            const list = button.closest('fieldset')?.querySelector('[data-today-trend-details]');
            if (!list || list.children.length >= 16) return;
            list.insertAdjacentHTML('beforeend', '<div><input name="detailLabel" maxlength="120" required><input name="detailValue" maxlength="600" required><button type="button" data-action="today-trend-remove-detail">删除</button></div>');
            if (list.children.length >= 16) button.disabled = true;
            return;
        }
        if (action === 'today-trend-remove-detail') {
            const fieldset = button.closest('fieldset'); button.parentElement?.remove();
            const add = fieldset?.querySelector('[data-action="today-trend-add-detail"]'); if (add) add.disabled = false;
            return;
        }
        if (action === 'today-trend-open-world') return run(open('world'));
        if (action === 'today-trend-open-world-settings') return run(open('world', 'settings'));
        if (action === 'today-trend-add-world-item') { view.editingWorldItemId = '__new__'; return run(rerender()); }
        if (action === 'today-trend-edit-world-item') { view.editingWorldItemId = button.dataset.worldItemId || null; return run(rerender()); }
        if (action === 'today-trend-cancel-world-editor') { view.editingWorldItemId = null; return run(rerender()); }
        if (action === 'today-trend-delete-world-item') return run(commit(scope => ({ ...scope, world: { ...scope.world, items: scope.world.items.filter(item => item.id !== button.dataset.worldItemId) } })).then(() => onStatus('世界态势项目已删除。')));
        if (action === 'today-trend-open-reputation') return run(open('reputation'));
        if (action === 'today-trend-open-reputation-settings') return run(open('reputation', 'settings'));
        if (action === 'today-trend-open-factions') return run(open('faction'));
        if (action === 'today-trend-open-faction-settings') return run(open('faction', 'settings'));
        if (action === 'today-trend-add-circle') { view.editingCircleId = '__new__'; return run(rerender()); }
        if (action === 'today-trend-edit-circle') { view.editingCircleId = button.dataset.circleId || null; return run(rerender()); }
        if (action === 'today-trend-add-faction') { view.mode = 'editor'; view.editingFactionId = '__new__'; return run(rerender()); }
        if (action === 'today-trend-edit-faction') { view.mode = 'editor'; view.editingFactionId = button.dataset.factionId || null; return run(rerender()); }
        if (action === 'today-trend-cancel-editor') { view.editingCircleId = null; view.editingFactionId = null; view.mode = view.name === 'faction' ? 'content' : 'settings'; return run(rerender()); }
        if (action === 'today-trend-open-dynamics') return run(open('dynamics'));
        if (action === 'today-trend-open-dynamics-settings') return run(open('dynamics', 'settings'));
        if (action === 'today-trend-create-event') { view.name = 'dynamics'; view.editingEventId = '__new__'; return run(rerender()); }
        if (action === 'today-trend-edit-event') { view.name = 'dynamics'; view.editingEventId = button.dataset.eventId || null; return run(rerender()); }
        if (action === 'today-trend-cancel-event-editor') { view.editingEventId = null; return run(rerender()); }
        if (action === 'today-trend-delete-event') return run(commit(scope => ({ ...scope, dynamics: { ...scope.dynamics, archived: scope.dynamics.archived.filter(item => item.id !== button.dataset.eventId) } })).then(() => onStatus('已删除归档事件。')));
        if (action === 'today-trend-advance-all-events') return run(onGenerate?.('dynamics') ?? Promise.reject(new Error('今日风向动态生成能力尚未接入')));
        if (action === 'today-trend-advance-event') return run(onRefresh?.('dynamics', button.dataset.eventId) ?? Promise.reject(new Error('今日风向动态推进能力尚未接入')));
        if (action === 'today-trend-promote-underground') { view.name = 'dynamics'; view.editingEventId = `promote:${button.dataset.eventId || ''}`; return run(rerender()); }
        if (action === 'today-trend-archive-event') { view.name = 'dynamics'; view.editingEventId = `archive:${button.dataset.eventId || ''}`; return run(rerender()); }
        if (action === 'today-trend-delete-circle') return run(commit(scope => ({ ...scope, reputation: { ...scope.reputation, circles: scope.reputation.circles.filter(item => item.id !== button.dataset.circleId) } })).then(() => onStatus('风评圈层已删除。')));
        if (action === 'today-trend-delete-faction') return run(commit(scope => ({ ...scope, factions: scope.factions.filter(item => item.id !== button.dataset.factionId).map(item => ({ ...item, parentId: item.parentId === button.dataset.factionId ? null : item.parentId, relatedFactionIds: item.relatedFactionIds.filter(id => id !== button.dataset.factionId) })) })).then(() => onStatus('相关势力已删除。')));
        if (action === 'today-trend-regenerate-circle-schema') return run(onRefresh?.('reputation', button.dataset.circleId, { mode: 'schema' }) ?? Promise.reject(new Error('今日风向圈层结构重新生成能力尚未接入')));
        const generation = { 'today-trend-generate-world': ['world'], 'today-trend-generate-reputation': ['reputation'], 'today-trend-generate-factions': ['faction'] }[action];
        if (generation) return run(onGenerate?.(...generation) ?? Promise.reject(new Error('今日风向生成能力尚未接入')));
        const refresh = { 'today-trend-refresh-world-item': ['world', button.dataset.worldItemId], 'today-trend-refresh-circle': ['reputation', button.dataset.circleId], 'today-trend-refresh-faction': ['faction', button.dataset.factionId] }[action];
        if (refresh) return run(onRefresh?.(...refresh) ?? Promise.reject(new Error('今日风向单项刷新能力尚未接入')));
        const rule = { 'today-trend-edit-world-rule': 'world', 'today-trend-regenerate-world-rule': 'world', 'today-trend-edit-reputation-rule': 'reputation', 'today-trend-regenerate-reputation-rule': 'reputation', 'today-trend-edit-faction-rule': 'faction', 'today-trend-regenerate-faction-rule': 'faction', 'today-trend-edit-dynamics-rule': 'dynamics', 'today-trend-regenerate-dynamics-rule': 'dynamics', 'today-trend-edit-incident-rule': 'dynamics-incident', 'today-trend-regenerate-incident-rule': 'dynamics-incident', 'today-trend-edit-rumor-rule': 'dynamics-rumor', 'today-trend-regenerate-rumor-rule': 'dynamics-rumor', 'today-trend-edit-underground-rule': 'dynamics-underground', 'today-trend-regenerate-underground-rule': 'dynamics-underground' }[action];
        if (rule) return run(onEditRule?.(rule, action.includes('regenerate')) ?? Promise.reject(new Error('今日风向规则编辑能力尚未接入')));
    };
    const submit = event => {
        const form = event.target;
        if (!form?.matches?.('form[data-today-trend-form]') || !container.contains(form)) return;
        event.preventDefault();
        if (form.dataset.todayTrendForm === 'world-item') return run(commit(scope => {
            const item = readWorldItem(form); const items = scope.world.items.filter(current => current.id !== item.id);
            return { ...scope, world: { ...scope.world, items: [...items, item] } };
        }).then(async () => { view.editingWorldItemId = null; await rerender(); onStatus('世界态势项目已保存。'); }));
        if (form.dataset.todayTrendForm === 'circle') return run(commit(scope => {
            const circle = readCircle(form); const existing = scope.reputation.circles.find(item => item.id === circle.id);
            return { ...scope, reputation: { ...scope.reputation, circles: replaceOrAppend(scope.reputation.circles, { ...circle, status: existing?.status || 'neutral', evaluation: existing?.evaluation || '尚待生成评价' }) } };
        }).then(async () => { view.editingCircleId = null; await rerender(); onStatus('风评圈层已保存。'); }));
        if (form.dataset.todayTrendForm === 'faction') return run(commit(scope => {
            const faction = readFaction(form); return { ...scope, factions: replaceOrAppend(scope.factions, faction) };
        }).then(async () => { view.mode = 'content'; view.editingFactionId = null; await rerender(); onStatus('相关势力已保存。'); }));
        if (form.dataset.todayTrendForm === 'event') return run(commit(scope => {
            const existing = scope.dynamics.active.find(item => item.id === formValue(form, 'id'));
            const next = readEvent(form, existing);
            if (existing) {
                const metadata = { ...existing, title: next.title, origin: next.origin, participants: next.participants };
                if (next.type !== existing.type) throw new Error('既有事件类型不能改写');
                if (next.latestStage === existing.latestStage && next.stageLabel === existing.stageLabel) {
                    return { ...scope, dynamics: { ...scope.dynamics, active: scope.dynamics.active.map(item => item.id === existing.id ? metadata : item) } };
                }
                const advanced = advanceTodayTrendEvent({ ...scope, dynamics: { ...scope.dynamics, active: scope.dynamics.active.map(item => item.id === existing.id ? metadata : item) } }, existing.id, { stageLabel: next.stageLabel, latestStage: next.latestStage });
                return advanced;
            }
            return { ...scope, dynamics: { ...scope.dynamics, active: [...scope.dynamics.active, next] } };
        }).then(async () => { view.editingEventId = null; await rerender(); onStatus('动态事件已保存。'); }));
        if (form.dataset.todayTrendForm === 'event-promotion') return run(commit(scope => {
            const sourceEventId = formValue(form, 'sourceEventId');
            const incident = readEvent(form);
            incident.type = 'incident';
            return promoteTodayTrendUnderground(scope, sourceEventId, incident);
        }).then(async () => { view.editingEventId = null; await rerender(); onStatus('地下线已升级为突发事件。'); }));
        if (form.dataset.todayTrendForm === 'event-archive') return run(commit(scope => {
            const id = formValue(form, 'id');
            const result = { outcome: formValue(form, 'outcome'), finalResult: formValue(form, 'finalResult') };
            const target = scope.dynamics.active.find(item => item.id === id);
            return target?.type === 'rumor' ? settleTodayTrendRumor(scope, id, result) : archiveTodayTrendEvent(scope, id, result);
        }).then(async () => { view.editingEventId = null; await rerender(); onStatus('动态事件已归档。'); }));
        if (form.dataset.todayTrendForm === 'dynamics-settings') return run(commit(scope => {
            const data = new FormData(form);
            const checked = name => data.get(name) === 'on';
            const trackingLimit = Number(data.get('trackingLimit'));
            const probability = Number(data.get('incidentProbability'));
            return { ...scope, dynamicsSettings: {
                ...scope.dynamicsSettings, trackingLimit, appendOnlyOnActualProgress: checked('appendOnlyOnActualProgress'),
                autoComplete: checked('autoComplete'), archiveCompleted: checked('archiveCompleted'),
                incident: { enabled: checked('incidentEnabled'), probability }, rumor: { enabled: checked('rumorEnabled') }, underground: { enabled: checked('undergroundEnabled') },
            } };
        }).then(async () => { view.mode = 'content'; await rerender(); onStatus('动态设置已保存。'); }));
    };
    container.addEventListener('click', click);
    container.addEventListener('submit', submit);
    return Object.freeze({ render: rerender, open, state: () => Object.freeze({ ...view }), destroy: () => { container.removeEventListener('click', click); container.removeEventListener('submit', submit); } });
}
