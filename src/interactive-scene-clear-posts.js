import { clearScenePosts } from './interactive-scene-model.js';

// 清空社区帖子：社区页菜单清空当前社区，设置页清空本聊天全部社区。社区本身与风格设定保留，只删帖子与评论。
export function createClearPostsActions({
    runtime, getStorageId, loadStore, getScope, current, commit, invalidate, resetView, refreshDesktop, rerender, setStatus,
    confirm = message => window.confirm(message), alert = message => window.alert(message),
}) {
    const confirmTwice = message => confirm(message) && confirm('清空后无法恢复，确定继续？');
    async function clearCurrent() {
        const { scene } = current();
        if (!scene) throw new Error('互动场景不存在');
        if (!scene.posts.length) { setStatus('本社区没有帖子'); return false; }
        if (!confirmTwice(`确定清空“${scene.title}”的全部 ${scene.posts.length} 篇帖子吗？评论会一并删除，社区与风格设定保留。`)) return false;
        invalidate();
        await commit(() => clearScenePosts(current().scene), null, '清空社区帖子');
        resetView(scene.id);
        refreshDesktop();
        rerender('feed');
        return true;
    }
    async function clearAllInChat() {
        const scopeId = getStorageId();
        if (!scopeId || scopeId === 'sms_unknown__default') { alert('请先打开有效的角色聊天。'); return false; }
        try {
            const store = await loadStore();
            const scenes = Object.values(store.scopes?.[scopeId]?.scenes || {});
            const total = scenes.reduce((sum, scene) => sum + scene.posts.length, 0);
            if (!total) { alert('本聊天的社区没有帖子。'); return false; }
            if (!confirmTwice(`确定清空本聊天 ${scenes.length} 个社区的全部 ${total} 篇帖子吗？评论会一并删除，社区与风格设定保留。`)) return false;
            invalidate();
            await commit(() => { for (const scene of Object.values(getScope(runtime.store, scopeId).scenes)) clearScenePosts(scene); }, null, '清空社区帖子');
            scenes.forEach(scene => resetView(scene.id));
            refreshDesktop(scopeId);
            if (runtime.openSceneId && (runtime.openSceneStorageId || scopeId) === scopeId) rerender('feed');
            alert(`已清空 ${total} 篇帖子。`);
            return true;
        } catch (error) {
            alert(`清空社区帖子失败：${error.message || error}`);
            return false;
        }
    }
    return { clearCurrent, clearAllInChat };
}
