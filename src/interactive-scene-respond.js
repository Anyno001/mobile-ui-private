import { INTERACTIVE_LIMITS } from './interactive-scene-constants.js';

// 即时回应与随机插入位置的纯函数：不读存储、不碰 DOM，随机数由调用方传入，便于测试打桩。

export const POST_WINDOW = 6;
// 同一批评论里相邻两条之间的默认时间间隔（毫秒）。
export const COMMENT_TIME_STEP = 45_000;

const defaultRandom = () => Math.random();

// 「发布后自动回应」缺省视为开；只有明确存为 false 才关闭。
export const isAutoRespondOn = scene => scene?.autoRespond !== false;

// 在 0..max 中选一个插入位置：上、中、下各占三分之一。
// 一个随机数同时决定区间与区间内的位置；max<2 时没有「中」，上下各一半。
export function pickSlot(max, random = defaultRandom) {
    const top = Math.max(0, Math.floor(Number(max) || 0));
    if (top === 0) return 0;
    const r = Math.min(Math.max(Number(random()) || 0, 0), 0.999999);
    const zone = Math.floor(r * 3);
    const fraction = r * 3 - zone;
    if (top === 1) return r < 0.5 ? 0 : 1;
    if (zone === 0) return 0;
    if (zone === 2) return top;
    return 1 + Math.floor(fraction * (top - 1));
}

// 帖子：用户的新帖子随机放进最新 POST_WINDOW 条的任意位置，只在插入时决定一次。
// posts 按时间从旧到新排列；返回插入后的下标。createdAt 夹在前后两条之间，保证数组顺序与时间一致。
export function placePostInWindow(posts, post, { random = defaultRandom, now = Date.now(), window: size = POST_WINDOW } = {}) {
    const list = posts;
    const span = Math.min(size, list.length);
    const index = list.length - span + pickSlot(span, random);
    const previous = index > 0 ? list[index - 1]?.createdAt : null;
    const next = index < list.length ? list[index]?.createdAt : null;
    let createdAt = Number.isFinite(post.createdAt) ? post.createdAt : now;
    if (Number.isFinite(next)) createdAt = Math.min(createdAt, next);
    if (Number.isFinite(previous)) createdAt = Math.max(createdAt, previous);
    post.createdAt = createdAt;
    list.splice(index, 0, post);
    return index;
}

// 评论中 quote 是被引用楼层的作者名：只在 comments[0..before) 里找同名作者的最近一条。
function quoteTargetId(comments, name, before) {
    const wanted = String(name ?? '').trim();
    if (!wanted) return '';
    for (let index = Math.min(before, comments.length) - 1; index >= 0; index -= 1) {
        if (comments[index]?.authorNameSnapshot === wanted && comments[index]?.id) return comments[index].id;
    }
    return '';
}

// 引用只能指向排在前面的评论，指向自己或后面的一律去掉。
export function pruneForwardQuotes(comments) {
    const position = new Map(comments.map((comment, index) => [comment.id, index]));
    return comments.map((comment, index) => {
        if (!Object.hasOwn(comment, 'quoteId')) return comment;
        const target = position.get(comment.quoteId);
        if (target !== undefined && target < index) return comment;
        const { quoteId: _dropped, ...rest } = comment;
        return rest;
    });
}

// 给新一批评论重排时间：整批按顺序严格递增，最后一条不晚于 now；不早于已有最后一条评论。
export function assignBatchTimes(count, { now = Date.now(), after = 0, step = COMMENT_TIME_STEP } = {}) {
    if (count <= 0) return [];
    let start = now - (count - 1) * step;
    let gap = step;
    if (start <= after) {
        start = after + 1;
        gap = count > 1 ? Math.max(1, Math.floor((now - start) / (count - 1))) : 0;
    }
    return Array.from({ length: count }, (_, index) => start + index * gap);
}

// 把模型返回的评论合并进帖子评论里。
// existing：帖子里已有的评论（不含这次要插入的用户评论）；
// userComment：用户刚发的评论，可为空（用户发的是帖子时没有）；
// generated：已构造好的模型评论，带 quoteName（可选，被引用楼层的作者名）；
// slot：用户评论在这一批里的位置 0..generated.length，由 pickSlot 给出。
// 返回 { comments, userIndex }，userIndex 是用户评论在最终数组里的下标（没有则为 -1）。
export function mergeRespondComments({ existing = [], userComment = null, generated = [], slot = 0, now = Date.now(), after = 0, limit = INTERACTIVE_LIMITS.comments } = {}) {
    const sequence = generated.map(item => ({ ...item }));
    const at = userComment ? Math.min(Math.max(0, slot), sequence.length) : -1;
    if (userComment) sequence.splice(at, 0, { ...userComment, isUser: true });
    const lastExisting = existing.reduce((latest, comment) => Math.max(latest, Number(comment?.createdAt) || 0), 0);
    const times = assignBatchTimes(sequence.length, { now, after: Math.max(after, lastExisting) });
    const placed = [];
    sequence.forEach((item, index) => {
        const { quoteName, isUser, ...comment } = item;
        comment.createdAt = times[index];
        if (!isUser && quoteName) {
            const quoteId = quoteTargetId([...existing, ...placed], quoteName, existing.length + placed.length);
            if (quoteId) comment.quoteId = quoteId;
        }
        placed.push(isUser ? { ...comment, __user: true } : comment);
    });
    // 先按上限截断再核对引用：被截掉的楼层若还被引用，引用一并去掉。
    const merged = pruneForwardQuotes([...existing, ...placed].slice(-limit));
    const userIndex = merged.findIndex(comment => comment.__user === true);
    return { comments: merged.map(({ __user, ...comment }) => comment), userIndex };
}
