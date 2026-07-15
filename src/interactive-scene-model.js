export const INTERACTIVE_LIMITS = Object.freeze({ scenes: 12, posts: 80, comments: 40, danmaku: 240 });

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const id = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function createEmptyInteractiveStore() {
    return { version: 1, scopes: {} };
}

function normalizeComment(raw) {
    const content = text(raw?.content, 1000);
    if (!content) return null;
    return { id: text(raw?.id, 80) || id('comment'), author: text(raw?.author, 80) || '匿名用户', content, createdAt: Number(raw?.createdAt) || Date.now() };
}

function normalizePost(raw) {
    const content = text(raw?.content, 4000);
    if (!content) return null;
    return {
        id: text(raw?.id, 80) || id('post'), author: text(raw?.author, 80) || '匿名用户',
        content, tags: list(raw?.tags).map(tag => text(tag, 30)).filter(Boolean).slice(0, 5),
        createdAt: Number(raw?.createdAt) || Date.now(),
        comments: list(raw?.comments).map(normalizeComment).filter(Boolean).slice(-INTERACTIVE_LIMITS.comments),
        liked: !!raw?.liked,
    };
}

function normalizeDanmaku(raw) {
    const content = text(raw?.content, 200);
    if (!content) return null;
    return { id: text(raw?.id, 80) || id('danmaku'), author: text(raw?.author, 80) || '观众', content, createdAt: Number(raw?.createdAt) || Date.now() };
}

export function normalizeScene(raw) {
    const sceneId = text(raw?.id, 80) || id('scene');
    return {
        id: sceneId, title: text(raw?.title, 80) || '未命名互动场景',
        preset: text(raw?.preset, 30) || 'weibo', styleInput: text(raw?.styleInput, 2000),
        generatedPrompt: text(raw?.generatedPrompt, 6000), contentRating: raw?.contentRating === 'mature' ? 'mature' : 'general',
        createdAt: Number(raw?.createdAt) || Date.now(), updatedAt: Number(raw?.updatedAt) || Date.now(),
        posts: list(raw?.posts).map(normalizePost).filter(Boolean).slice(-INTERACTIVE_LIMITS.posts),
        live: { title: text(raw?.live?.title, 100) || '正在直播', status: 'idle', danmaku: list(raw?.live?.danmaku).map(normalizeDanmaku).filter(Boolean).slice(-INTERACTIVE_LIMITS.danmaku) },
    };
}

export function addSceneComment(scene, postId, author, content) {
    const post = scene?.posts?.find(item => item.id === postId);
    const normalizedContent = text(content, 1000);
    if (!post) throw new Error('帖子不存在');
    if (!normalizedContent) throw new Error('评论内容不能为空');
    post.comments.push({
        id: id('comment'), author: text(author, 80) || '我', content: normalizedContent, createdAt: Date.now(),
    });
    post.comments = post.comments.slice(-INTERACTIVE_LIMITS.comments);
    scene.updatedAt = Date.now();
    return post.comments.at(-1);
}

export function updateScenePost(scene, postId, content) {
    const post = scene?.posts?.find(item => item.id === postId);
    const normalizedContent = text(content, 4000);
    if (!post) throw new Error('帖子不存在');
    if (!normalizedContent) throw new Error('帖子内容不能为空');
    post.content = normalizedContent;
    scene.updatedAt = Date.now();
}

export function updateSceneComment(scene, postId, commentId, content) {
    const post = scene?.posts?.find(item => item.id === postId);
    const comment = post?.comments?.find(item => item.id === commentId);
    const normalizedContent = text(content, 1000);
    if (!post || !comment) throw new Error('评论不存在');
    if (!normalizedContent) throw new Error('评论内容不能为空');
    comment.content = normalizedContent;
    scene.updatedAt = Date.now();
}

export function deleteScenePost(scene, postId) {
    if (!scene?.posts?.some(item => item.id === postId)) throw new Error('帖子不存在');
    scene.posts = scene.posts.filter(item => item.id !== postId);
    scene.updatedAt = Date.now();
}

export function deleteSceneComment(scene, postId, commentId) {
    const post = scene?.posts?.find(item => item.id === postId);
    if (!post?.comments?.some(item => item.id === commentId)) throw new Error('评论不存在');
    post.comments = post.comments.filter(item => item.id !== commentId);
    scene.updatedAt = Date.now();
}

export function deleteInteractiveScene(scope, sceneId) {
    if (!scope?.scenes?.[sceneId]) throw new Error('互动场景不存在');
    delete scope.scenes[sceneId];
    scope.sceneOrder = scope.sceneOrder.filter(idValue => idValue !== sceneId);
    scope.activeSceneId = scope.scenes[scope.activeSceneId] ? scope.activeSceneId : scope.sceneOrder.at(-1) || null;
}

export function enforceInteractiveSceneLimit(scope) {
    while (scope.sceneOrder.length > INTERACTIVE_LIMITS.scenes) {
        const removedId = scope.sceneOrder.shift();
        delete scope.scenes[removedId];
    }
}

export function normalizeInteractiveStore(raw) {
    const result = createEmptyInteractiveStore();
    if (!raw || typeof raw !== 'object') return result;
    for (const [scopeId, value] of Object.entries(raw.scopes || {})) {
        const scenes = {};
        const order = list(value?.sceneOrder).map(key => text(key, 80)).filter(Boolean).slice(-INTERACTIVE_LIMITS.scenes);
        for (const key of order) if (value?.scenes?.[key]) scenes[key] = normalizeScene(value.scenes[key]);
        result.scopes[scopeId] = { activeSceneId: scenes[value?.activeSceneId] ? value.activeSceneId : order.at(-1) || null, sceneOrder: Object.keys(scenes), scenes };
    }
    return result;
}
