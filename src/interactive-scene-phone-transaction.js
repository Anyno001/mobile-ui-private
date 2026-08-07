export function createCommitWithPhoneUi({ getPhoneUiState, persistPhoneUiState, getStore, commit }) {
    if (![getPhoneUiState, persistPhoneUiState, getStore, commit].every(value => typeof value === 'function')) {
        throw new TypeError('手机页面事务依赖无效');
    }
    return async (scopeId, mutateStore, createPhoneUiState, context) => {
        const phoneUiSnapshot = structuredClone(getPhoneUiState(getStore()));
        try {
            return await commit(() => {
                mutateStore();
                persistPhoneUiState(scopeId, createPhoneUiState(), getStore());
            }, null, context);
        } catch (error) {
            try {
                persistPhoneUiState(scopeId, phoneUiSnapshot, getStore());
            } catch (rollbackError) {
                const combined = new Error(`${error.message}；手机页面状态补偿也失败：${rollbackError.message}`);
                combined.cause = error;
                combined.rollbackError = rollbackError;
                throw combined;
            }
            throw error;
        }
    };
}
