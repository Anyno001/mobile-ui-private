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
    const characterName = String(scope.characterName).replace(/[\r\n]/g, ' ').trim();
    return [
        section(`${characterName}·个人风评`, (scope.reputation?.circles || []).map(item => line([item.name, item.status, item.evaluation])), remaining),
        section(`${characterName}·势力关系`, (scope.factions || []).map(item => line([item.name, item.relation?.status, item.relation?.evaluation])), remaining),
        section(`${characterName}·事件追踪`, (scope.dynamics?.active || []).map(item => line([item.title, item.stageLabel, item.latestStage])), remaining),
    ].filter(Boolean).join('\n\n');
}
