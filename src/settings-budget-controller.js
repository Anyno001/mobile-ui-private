export function createBudgetController({ normalizeBudgetConfig, resolveBudgetPercentageInput, saveBudgetConfig, requireInjectionSuccess, applyBidirectionalInjection, addNote, showBudget }) {
    const readSourceWeights = () => {
        const fields = ['phone', 'community', 'calendar', 'todayTrend'];
        const values = Object.fromEntries(fields.map(name => [name, document.getElementById(`pm-budget-${name}-weight`)]));
        return resolveBudgetPercentageInput({
            sourceWeights: normalizeBudgetConfig(window.__pmBudgetConfig).sourceWeights,
            ...Object.fromEntries(fields.map(name => [name, values[name]?.value])),
            ...Object.fromEntries(fields.map(name => [`initial${name[0].toUpperCase()}${name.slice(1)}`, values[name]?.dataset.initialValue])),
        });
    };
    const save = async () => {
        let sourceWeights;
        try { sourceWeights = readSourceWeights(); } catch (error) { alert(error.message); return; }
        const source = document.getElementById('pm-budget-priority')?.value;
        const priority = [source, 'phone', 'community', 'calendar', 'todayTrend'].filter((value, index, values) => value && values.indexOf(value) === index);
        const candidate = normalizeBudgetConfig({
            ...normalizeBudgetConfig(window.__pmBudgetConfig),
            targetTokens: Number(document.getElementById('pm-budget-target')?.value), sourceWeights, sourcePriority: priority,
            redistributeUnused: document.getElementById('pm-budget-redistribute')?.classList.contains('is-checked') === true,
        });
        if (!saveBudgetConfig(candidate)) { alert('上下文预算保存失败：浏览器存储不可用'); return false; }
        try { await requireInjectionSuccess(() => applyBidirectionalInjection(), '配置已保存，但注入刷新失败'); }
        catch (error) { alert(`配置已保存，但注入刷新失败：${error.message}`); return false; }
        document.getElementById('pm-overlay')?.remove();
        addNote('上下文预算已保存（token 为估算值）');
        return true;
    };
    const reset = async () => {
        const candidate = normalizeBudgetConfig();
        if (!saveBudgetConfig(candidate)) { alert('上下文预算重置失败：浏览器存储不可用'); return false; }
        try { await requireInjectionSuccess(() => applyBidirectionalInjection(), '配置已保存，但注入刷新失败'); }
        catch (error) { alert(`配置已保存，但注入刷新失败：${error.message}`); return false; }
        showBudget();
        return true;
    };
    return { save, reset };
}
