export function createCommunityTemplateImportAction({
    getStorageId, loadStore, getInteractiveStore, getPhoneUiState, getScope, phoneScope, commitWithPhoneUi,
    patchPhoneUiScope, refreshDesktop, openScene, createSceneFromCommunityTemplate,
    createSceneId, sceneLimit,
}) {
    return async templateId => {
        const scopeId = getStorageId();
        if (!scopeId || scopeId === 'sms_unknown__default') throw new Error('请先打开有效的角色聊天');
        await loadStore();
        let importedSceneId = null;
        let nextPhoneUiState = null;
        await commitWithPhoneUi(scopeId, () => {
            const state = getPhoneUiState();
            const template = (state.sharedCommunityTemplates || []).find(item => item.id === templateId);
            if (!template) throw new Error('共享社区模板不存在或已取消发布');
            const scope = getScope(scopeId);
            const mappedSceneId = state.scopes[scopeId]?.importedTemplateSceneIds?.[template.id];
            if (mappedSceneId && scope.scenes[mappedSceneId]) {
                importedSceneId = mappedSceneId;
                nextPhoneUiState = state;
                return;
            }
            if (scope.sceneOrder.length >= sceneLimit) throw new Error(`社区数量已达上限（${sceneLimit}），请先删除不需要的社区`);
            const scene = createSceneFromCommunityTemplate(template, createSceneId());
            scope.scenes[scene.id] = scene;
            scope.sceneOrder.push(scene.id);
            scope.activeSceneId = scene.id;
            importedSceneId = scene.id;
            const phoneUiScope = phoneScope(scopeId);
            nextPhoneUiState = patchPhoneUiScope(state, scopeId, {
                importedTemplateSceneIds: { ...phoneUiScope.importedTemplateSceneIds, [template.id]: scene.id },
            }, getInteractiveStore());
        }, () => nextPhoneUiState, '导入社区模板');
        refreshDesktop(scopeId);
        await openScene(importedSceneId, 'feed');
    };
}
