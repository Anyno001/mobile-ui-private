import { openPlotDialog } from './story-plot-io.js';
import { escapeHtml } from './ui.js';

// 导入前询问是否带上原社区的帖子：返回 'keep' / 'blank'，关闭弹窗为 null（不导入）。
export const askKeepPostsDialog = deps => ({ title, count }) => openPlotDialog(deps, {
    title: '导入社区模板',
    body: `<p class="pm-cfg-tip">“${escapeHtml(title)}”在原聊天已有 ${count} 篇帖子，是否一并导入？</p>`,
    actions: [{ label: '空白导入', value: 'blank' }, { label: '保留帖子', value: 'keep', primary: true }],
}).then(result => result?.action || null);

export function createCommunityTemplateImportAction({
    getStorageId, loadStore, getInteractiveStore, getPhoneUiState, getScope, phoneScope, commitWithPhoneUi,
    patchPhoneUiScope, refreshDesktop, openScene, createSceneFromCommunityTemplate,
    createSceneId, sceneLimit, reconcileForeign = async () => {}, askKeepPosts = async () => 'blank', copyPosts = null,
}) {
    // 原社区的贴文：在本机读不到（来源聊天已删或未同步）时视为没有。
    const sourcePostsOf = template => getInteractiveStore()?.scopes?.[template.sourceStorageId]?.scenes?.[template.sourceSceneId]?.posts || [];
    return async templateId => {
        const scopeId = getStorageId();
        if (!scopeId || scopeId === 'sms_unknown__default') throw new Error('请先打开有效的角色聊天');
        await loadStore();
        const findTemplate = () => (getPhoneUiState().sharedCommunityTemplates || []).find(item => item.id === templateId);
        const mappedSceneOf = template => {
            const sceneId = getPhoneUiState().scopes[scopeId]?.importedTemplateSceneIds?.[template.id];
            return sceneId && getInteractiveStore()?.scopes?.[scopeId]?.scenes?.[sceneId] ? sceneId : null;
        };
        // 已导入过的模板直接打开，不再询问；社区已满时先报错，不弹询问。
        let keepPosts = false;
        const first = findTemplate();
        if (first && !mappedSceneOf(first) && copyPosts
            && (getInteractiveStore()?.scopes?.[scopeId]?.sceneOrder?.length || 0) < sceneLimit) {
            await reconcileForeign(first.sourceStorageId);
            const count = sourcePostsOf(first).length;
            if (count) {
                const choice = await askKeepPosts({ title: first.title, count });
                if (!choice) return;
                keepPosts = choice === 'keep';
            }
        }
        let importedSceneId = null;
        let nextPhoneUiState = null;
        await commitWithPhoneUi(scopeId, () => {
            const state = getPhoneUiState();
            const template = (state.sharedCommunityTemplates || []).find(item => item.id === templateId);
            if (!template) throw new Error('共享社区模板不存在或已取消发布');
            const scope = getScope(scopeId);
            const mappedSceneId = mappedSceneOf(template);
            if (mappedSceneId) {
                importedSceneId = mappedSceneId;
                nextPhoneUiState = state;
                return;
            }
            if (scope.sceneOrder.length >= sceneLimit) throw new Error(`社区数量已达上限（${sceneLimit}），请先删除不需要的社区`);
            const scene = createSceneFromCommunityTemplate(template, createSceneId());
            if (keepPosts) {
                const sourceScope = getInteractiveStore()?.scopes?.[template.sourceStorageId];
                scene.posts = copyPosts(sourceScope, scope, scopeId, sourcePostsOf(template));
            }
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
