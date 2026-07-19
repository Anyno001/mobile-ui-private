const cleanText = (value, max) => {
    if (typeof value !== 'string') return '';
    return Array.from(value.trim()).slice(0, max).join('');
};

function renderAuthor(item, actors) {
    const actor = actors && Object.hasOwn(actors, item.authorId) ? actors[item.authorId] : null;
    return cleanText(item.authorNameSnapshot, 80) || cleanText(actor?.displayName, 80) || '匿名用户';
}

export function renderCommunitySource(source) {
    if (!source || source.type !== 'community' || !source.scene) return '';
    const { scene, actors, selection } = source;
    const selectedPostIds = selection?.mode === 'selected'
        ? new Set(Array.isArray(selection.postIds) ? selection.postIds : []) : null;
    const lines = [`【互动社区：${cleanText(scene.title, 80) || '未命名场景'}】`];
    for (const post of Array.isArray(scene.posts) ? scene.posts : []) {
        if (selectedPostIds && !selectedPostIds.has(post?.id)) continue;
        const content = cleanText(post?.content, 4000);
        if (!content) continue;
        lines.push(`${renderAuthor(post, actors)}：${content}`);
        for (const comment of Array.isArray(post.comments) ? post.comments : []) {
            const commentText = cleanText(comment?.content, 1000);
            if (commentText) lines.push(`  评论 · ${renderAuthor(comment, actors)}：${commentText}`);
        }
    }
    const danmaku = Array.isArray(scene.live?.danmaku) ? scene.live.danmaku : [];
    if (danmaku.length) {
        lines.push(`【${cleanText(scene.live?.title, 100) || '直播'}】`);
        for (const item of danmaku) {
            const content = cleanText(item?.content, 200);
            if (content) lines.push(`  ${renderAuthor(item, actors)}：${content}`);
        }
    }
    return lines.length > 1 ? lines.join('\n') : '';
}
