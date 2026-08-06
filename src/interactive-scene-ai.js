import { parseFirstJsonObject } from './ai.js';
export {
    buildInteractiveRequest,
    buildStylePrompt,
    getInteractivePresets,
} from './prompts/interactive/interactive.js';

function parseEnvelope(raw, expectedKind) {
    const value = parseFirstJsonObject(
        raw, 'AI 未返回可解析的社区 JSON',
        candidate => !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
            && candidate.version === 1 && candidate.kind === expectedKind && Array.isArray(candidate.items),
    );
    if (!value || Array.isArray(value) || value.version !== 1 || value.kind !== expectedKind || !Array.isArray(value.items)) throw new Error('AI 返回协议不匹配');
    const keys = Object.keys(value).sort();
    if (keys.length !== 3 || keys[0] !== 'items' || keys[1] !== 'kind' || keys[2] !== 'version') throw new Error('AI 返回协议包含额外字段');
    return value.items;
}

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

function cleanFeedComments(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('AI 返回的 comments 必须是数组');
    const comments = value.flatMap(comment => {
        if (!comment || typeof comment !== 'object' || Array.isArray(comment)) return [];
        if (Object.keys(comment).some(key => !['author', 'content'].includes(key))) return [];
        const content = clean(comment.content, 1000);
        if (!content) return [];
        return [{ author: clean(comment.author, 80) || '匿名用户', content }];
    });
    if (comments.length < 2) throw new Error('AI 返回的 comments 有效内容不足 2 条');
    return comments.slice(0, 5);
}

export function parseInteractiveResponse(raw, kind) {
    const maxItems = kind === 'style_prompt' ? 1 : kind === 'feed_batch' ? 8 : kind === 'comment_batch' ? 12 : kind === 'danmaku_batch' ? 20 : 20;
    const items = parseEnvelope(raw, kind).slice(0, maxItems).flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        if (kind === 'style_prompt') {
            if (Object.keys(item).some(key => !['title', 'prompt'].includes(key))) return [];
            const prompt = clean(item.prompt, 6000);
            return prompt ? [{ title: clean(item.title, 80) || '我的社区', prompt }] : [];
        }
        const allowed = kind === 'feed_batch' ? ['author', 'content', 'tags', 'comments'] : ['author', 'content'];
        if (Object.keys(item).some(key => !allowed.includes(key))) return [];
        const content = clean(item.content, kind === 'feed_batch' ? 4000 : kind === 'comment_batch' ? 1000 : 200);
        if (!content) return [];
        return [{
            author: clean(item.author, 80) || '匿名用户',
            content,
            tags: Array.isArray(item.tags) ? item.tags.map(tag => clean(tag, 30)).filter(Boolean).slice(0, 5) : [],
            ...(kind === 'feed_batch' ? { comments: cleanFeedComments(item.comments) } : {}),
        }];
    });
    if (!items.length) throw new Error('AI 未返回有效内容');
    return items;
}
