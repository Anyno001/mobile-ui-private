import { todayTrendStatusLabel } from './today-trend-model.js';

const line = values => values.map(value => String(value || '').replace(/[\r\n｜]/g, ' ').trim()).join('｜');

function section(title, rows, remaining) {
    if (!rows.length || remaining.value <= 0) return '';
    const kept = rows.slice(0, remaining.value);
    remaining.value -= kept.length;
    return `[${title}]\n${kept.join('\n')}`;
}

/**
 * Produces the committed social-state prompt only. It intentionally has no AI,
 * UI, storage, or host-runtime dependency.
 */
export function renderTodayTrendInjection(scope, { maxLines = Infinity } = {}) {
    if (!scope?.injection?.enabled || !scope.characterName) return '';
    const limit = Number.isInteger(maxLines) && maxLines >= 0 ? maxLines : Infinity;
    const remaining = { value: limit };
    return [
        section(`<user> 的个人风评`, (scope.reputation?.circles || []).map(item => line([item.name, todayTrendStatusLabel(item.status), item.evaluation])), remaining),
        section(`势力关系`, (scope.factions || []).map(item => line([item.name, todayTrendStatusLabel(item.relation?.status), item.relation?.evaluation])), remaining),
        section(`事件追踪`, (scope.dynamics?.active || []).map(item => line([item.title, item.stageLabel, item.latestStage])), remaining),
    ].filter(Boolean).join('\n\n');
}
