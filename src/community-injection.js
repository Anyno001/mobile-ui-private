import { COMMUNITY_PLATFORMS, platformForPreset } from './interactive-scene-constants.js';

const PLATFORM_NAMES = Object.freeze({
    weibo: '微博广场', douban: '小组论坛', review: '书评', confess: '树洞', night: '夜间来信',
});
const DANMAKU_TAGS = Object.freeze({ host: '[主播] ', gift: '[礼物] ', system: '[系统] ' });

const cleanText = (value, max) => {
    if (typeof value !== 'string') return '';
    return Array.from(value.trim()).slice(0, max).join('');
};

function renderAuthor(item, actors) {
    const actor = actors && Object.hasOwn(actors, item.authorId) ? actors[item.authorId] : null;
    return cleanText(item.authorNameSnapshot, 80) || cleanText(actor?.displayName, 80) || '匿名用户';
}

const platformOf = scene => (COMMUNITY_PLATFORMS.includes(scene?.platform) ? scene.platform : platformForPreset(scene?.preset));
const comments = post => (Array.isArray(post?.comments) ? post.comments : []);
const star = rating => (Number.isInteger(rating) && rating >= 1 && rating <= 5 ? ` ★${rating}` : '');

// 每个平台一个渲染函数：输入一条帖子，返回要写入的行。正文为空的帖子由调用方跳过。
const POST_RENDERERS = {
    weibo(post, content, author, actors) {
        const repostText = cleanText(post.repost?.content, 1000);
        const repost = repostText ? `（转发 @${cleanText(post.repost.author, 80) || '匿名用户'}：${repostText}）` : '';
        const lines = [`${author}：${content}${repost}`];
        for (const comment of comments(post)) {
            const text = cleanText(comment?.content, 1000);
            if (text) lines.push(`  评论 ${renderAuthor(comment, actors)}：${text}`);
        }
        return lines;
    },
    douban(post, content, author, actors) {
        const title = cleanText(post.title, 80);
        const lines = [`${title ? `【${title}】` : ''}${author}：${content}`];
        const all = comments(post);
        all.forEach((comment, index) => {
            const text = cleanText(comment?.content, 1000);
            if (!text) return;
            const target = comment.quoteId ? all.find(item => item?.id === comment.quoteId) : null;
            const reply = target ? `（回复 ${renderAuthor(target, actors)}）` : '';
            lines.push(`  ${index + 2}楼 ${renderAuthor(comment, actors)}${reply}：${text}`);
        });
        return lines;
    },
    review(post, content, author, actors) {
        const work = cleanText(post.work, 80);
        const head = [
            work ? `《${work}》${cleanText(post.workAuthor, 40)}${star(post.rating)}` : star(post.rating).trim(),
            cleanText(post.title, 80),
            `${author}：${content}`,
        ].filter(Boolean);
        const lines = [head.join('｜')];
        for (const comment of comments(post)) {
            const text = cleanText(comment?.content, 1000);
            if (text) lines.push(`  短评 ${renderAuthor(comment, actors)}${star(comment.rating)}：${text}`);
        }
        return lines;
    },
    confess(post, content, author, actors) {
        const mood = cleanText(post.mood, 12);
        const lines = [`${mood ? `[${mood}] ` : ''}${author}：${content}`];
        for (const comment of comments(post)) {
            const text = cleanText(comment?.content, 1000);
            if (text) lines.push(`  评论 ${renderAuthor(comment, actors)}：${text}`);
        }
        return lines;
    },
    night(post, content, author, actors) {
        const to = cleanText(post.to, 40);
        const sign = cleanText(post.sign, 40) || author;
        const lines = [`${to ? `写给 ${to}` : '来信'}：${content} —— ${sign}`];
        for (const comment of comments(post)) {
            const text = cleanText(comment?.content, 1000);
            if (text) lines.push(`  回信 ${renderAuthor(comment, actors)}：${text}`);
        }
        return lines;
    },
};

// 场景级的开头：微博的热搜、夜间来信的今夜题目。
function renderSceneHeader(platform, scene) {
    if (platform === 'weibo') {
        const hot = (Array.isArray(scene.hot) ? scene.hot : []).map(item => cleanText(item?.title, 30)).filter(Boolean);
        return hot.length ? [`热搜：${hot.join('、')}`] : [];
    }
    if (platform === 'night') {
        const tonight = cleanText(scene.tonight?.title, 60);
        return tonight ? [`今夜信箱：${tonight}`] : [];
    }
    return [];
}

export function renderCommunitySource(source) {
    if (!source || source.type !== 'community' || !source.scene) return '';
    const { scene, actors, selection, liveRoom } = source;
    const platform = platformOf(scene);
    const selectedPostIds = selection?.mode === 'selected'
        ? new Set(Array.isArray(selection.postIds) ? selection.postIds : []) : null;
    const body = [];
    for (const post of Array.isArray(scene.posts) ? scene.posts : []) {
        if (selectedPostIds && !selectedPostIds.has(post?.id)) continue;
        const content = cleanText(post?.content, 4000);
        if (!content) continue;
        body.push(...POST_RENDERERS[platform](post, content, renderAuthor(post, actors), actors));
    }
    const danmaku = Array.isArray(liveRoom?.danmaku) ? liveRoom.danmaku : [];
    const live = [];
    for (const item of danmaku) {
        const content = cleanText(item?.content, 200);
        if (content) live.push(`  ${DANMAKU_TAGS[item.kind] || ''}${renderAuthor(item, actors)}：${content}`);
    }
    if (!body.length && !live.length) return '';
    const lines = [`【社区·${PLATFORM_NAMES[platform]}：${cleanText(scene.title, 80) || '未命名场景'}】`, ...renderSceneHeader(platform, scene), ...body];
    if (live.length) lines.push(`【${cleanText(liveRoom?.title, 100) || '直播'}】`, ...live);
    return lines.join('\n');
}
