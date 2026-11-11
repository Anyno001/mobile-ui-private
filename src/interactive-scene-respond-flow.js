import { generationErrorMessage } from './ai.js';
import { appendScenePosts, ensureInteractiveActor, INTERACTIVE_LIMITS, resolveInteractiveAuthor } from './interactive-scene-model.js';
import { isAutoRespondOn, mergeRespondComments, pickSlot } from './interactive-scene-respond.js';
import { platformOf } from './community-views/view-shared.js';
import { now, uid } from './interactive-scenes-utils.js';
import { communityFloorMark } from './community-floor-rollback.js';

// 发布后即时回应的流程：由 interactive-scenes.js 注入运行时依赖，这里只管请求、合并、重绘与高亮。
export function createRespondFlow({
    runtime, communityTasks, current, resolveTarget, actorSeeds, operationGuard, request, commit, rerender, setStatus, viewOf, randomSource,
}) {
    // ===== 发布后即时回应 =====
    // 用户发帖或评论后立刻调用一次 comment_batch；用户内容已先存下，回应失败或被占线时保留，并在条目旁出现「重新回应」。
    const RESPOND_BUSY_TEXT = '上一条还在回应中';
    const REVEAL_HIGHLIGHT_MS = 1800;
    const markRetry = (sceneId, entryId) => {
        const view = viewOf(sceneId);
        if (!view.retry.includes(entryId)) view.retry.push(entryId);
    };
    const clearRetry = (sceneId, entryId) => {
        const view = viewOf(sceneId);
        view.retry = view.retry.filter(item => item !== entryId);
    };
    // 微博、树洞、夜间来信的评论默认折叠，用户那条要可见就得展开所属帖子；小组的楼层本来就全部展开。
    // 朋友圈、小红书、新闻的评论本来就全部显示；知乎回答的评论要展开回答才看得到。
    function ensureCommentsVisible(scene, postId) {
        if (['douban', 'moments', 'xhs', 'news'].includes(platformOf(scene))) return;
        const view = viewOf(scene.id);
        if (!view.open.includes(postId)) view.open.push(postId);
    }
    // 滚到条目并短暂高亮；用 data-entry-id 定位，不拼选择器。reduced-motion 下滚动不带动画，高亮不做过渡（见 community.css）。
    function revealEntry(entryId) {
        const app = document.getElementById('pm-scene-app');
        let target = null;
        for (const node of app?.querySelectorAll?.('[data-entry-id]') || []) {
            if (node.dataset?.entryId === entryId) { target = node; break; }
        }
        if (!target) return false;
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        target.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        target.classList?.add('is-fresh');
        globalThis.setTimeout?.(() => target.classList?.remove('is-fresh'), REVEAL_HIGHLIGHT_MS);
        return true;
    }
    const respondPostContext = (post, excludeCommentId = '') => {
        const head = [post.question && `问题：${post.question}`, post.title && `标题：${post.title}`, post.work && `书名：${post.work}`, post.rating && `评分：${post.rating}星`, post.content]
            .filter(Boolean).join('\n').slice(0, 2400);
        const recent = post.comments.filter(item => item.id !== excludeCommentId).slice(-6)
            .map(item => `${item.authorNameSnapshot}：${String(item.content).slice(0, 120)}`).join('\n');
        return recent ? `${head}\n已有评论：\n${recent}` : head;
    };
    const isSubpageShown = () => !!document.querySelector('#pm-scene-app .pm-scene-prompt, #pm-scene-app .pm-scene-injection-settings');
    // kind：'post' 回应用户刚发的帖子，'comment' 回应用户刚发的评论。返回 true 表示回应已写入。
    async function respondToUser({ kind, postId, commentId = '', replyOwner = false, manual = false }) {
        const { scopeId, scene } = current();
        if (!scene || !postId) return false;
        if (!manual && !isAutoRespondOn(scene)) return false;
        const sceneId = scene.id;
        const entryId = kind === 'comment' ? commentId : postId;
        const target = { storageId: scopeId, sceneId };
        const task = runtime.busy || runtime.creating ? null : communityTasks.begin({ kind: 'respond', ...target });
        if (!task) {
            markRetry(sceneId, entryId);
            if (!isSubpageShown()) rerender('feed', { preserveFeedScroll: true });
            setStatus(RESPOND_BUSY_TEXT);
            return false;
        }
        const isValid = operationGuard(scopeId, sceneId);
        try {
            communityTasks.markGenerating(task);
            const post = scene.posts.find(item => item.id === postId);
            const userComment = kind === 'comment' ? post?.comments.find(item => item.id === commentId) : null;
            if (!post || (kind === 'comment' && !userComment)) throw new Error(kind === 'comment' ? '评论不存在' : '帖子不存在');
            const userName = (userComment || post).authorNameSnapshot;
            // 知乎提问：回应是回答，每条另成一篇挂在同一问题下的帖子，而不是评论。
            const asking = kind === 'post' && post.ask === true && platformOf(scene) === 'zhihu';
            const items = await request('comment_batch', {
                post: respondPostContext(post, commentId),
                respondTo: { type: kind, author: userName, content: asking ? `${post.question}\n${post.content}` : (userComment || post).content, replyOwner, ...(asking ? { ask: true } : {}) },
            }, target);
            if (!communityTasks.isActive(task)) throw new Error('生成已取消');
            await commit(() => {
                const resolved = resolveTarget(target);
                const currentPost = resolved.scene?.posts.find(item => item.id === postId);
                if (!currentPost) throw new Error('帖子不存在');
                const seeds = actorSeeds(resolved.scopeId);
                if (asking) {
                    const answers = items.filter(item => item.author !== userName).map(item => ({
                        author: item.author, content: item.content, tags: [], comments: [], question: currentPost.question, ...(item.authorBio ? { authorBio: item.authorBio } : {}),
                    }));
                    if (!appendScenePosts(resolved.scope, resolved.scopeId, resolved.scene, answers, [seeds.story, seeds.user]).length) throw new Error('AI未返回有效内容');
                    return;
                }
                ensureInteractiveActor(resolved.scope, resolved.scopeId, seeds.story);
                ensureInteractiveActor(resolved.scope, resolved.scopeId, seeds.user);
                const generated = items.filter(item => item.author !== userName).map(item => ({
                    id: uid('comment'), ...resolveInteractiveAuthor(resolved.scope, resolved.scopeId, item.author),
                    content: item.content,
                    ...(item.quote ? { quoteName: item.quote } : {}),
                    ...(item.rating ? { rating: item.rating } : {}),
                    ...communityFloorMark(),
                }));
                if (!generated.length) throw new Error('AI未返回有效内容');
                // 用户评论从原位取出，随机放进这一批里；位置只在这里决定一次，写进数组顺序，之后渲染不再变。
                const mine = kind === 'comment' ? currentPost.comments.find(item => item.id === commentId) || null : null;
                // 虎扑回帖是平铺楼层，接话要排在用户那条下面，所以用户那条固定在这一批最前。
                const slot = mine && platformOf(resolved.scene) === 'hupu' ? 0 : pickSlot(generated.length, randomSource);
                const merged = mergeRespondComments({
                    existing: currentPost.comments.filter(item => item !== mine), userComment: mine, generated,
                    slot, now: now(), after: currentPost.createdAt,
                    limit: INTERACTIVE_LIMITS.comments,
                });
                currentPost.comments = merged.comments;
                resolved.scene.updatedAt = now();
            }, () => isValid() && communityTasks.isActive(task), '即时回应');
            communityTasks.finish(task);
            clearRetry(sceneId, entryId);
            ensureCommentsVisible(scene, postId);
            if (!isSubpageShown()) { rerender('feed'); revealEntry(entryId); }
            return true;
        } catch (error) {
            communityTasks.finish(task, error);
            markRetry(sceneId, entryId);
            const cancelled = error?.message === '生成已取消' || error?.message === '即时回应已取消' || error?.name === 'AbortError';
            if (current().scene?.id === sceneId && !isSubpageShown()) rerender('feed', { preserveFeedScroll: true });
            if (!cancelled) setStatus(generationErrorMessage(error));
            return false;
        }
    }
    // 点「重新回应」：清掉失败标记后手动再请求一次。
    async function retryRespond({ postId, targetId: entryId, entryKind }) {
        const sceneId = current().scene?.id;
        if (!sceneId || !postId || !entryId) return false;
        clearRetry(sceneId, entryId);
        rerender('feed', { preserveFeedScroll: true });
        return respondToUser({
            kind: entryKind === 'comment' ? 'comment' : 'post', postId, commentId: entryKind === 'comment' ? entryId : '',
            replyOwner: entryKind === 'comment' && platformOf(current().scene) === 'douban', manual: true,
        });
    }
    return { respondToUser, retryRespond, revealEntry, ensureCommentsVisible };
}
