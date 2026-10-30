// 朋友圈、小红书、知乎、新闻（B2）新增的帖子可选字段：缺省不输出键，宽松读入时非法值丢弃，v3 严格校验时报错。
// 小红书的 title 沿用已有的 title 字段，这里不重复。
import { MOMENTS_AUDIENCES, MOMENTS_LIKERS_MAX } from './interactive-scene-constants.js';

export const B2_POST_KEYS = Object.freeze(['likers', 'place', 'audience', 'question', 'authorBio', 'ask', 'column']);

const LIMITS = Object.freeze({ place: 40, question: 80, authorBio: 30, column: 12, liker: 80 });

const cleanText = (value, max) => (typeof value === 'string' ? Array.from(value.trim()).slice(0, max).join('') : '');

// 点赞名单：字符串数组，去空、去重，最多 12 个。
function normalizeLikers(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(name => cleanText(name, LIMITS.liker)).filter(Boolean))].slice(0, MOMENTS_LIKERS_MAX);
}

export function normalizeB2PostFields(raw) {
    const likers = normalizeLikers(raw?.likers);
    const place = cleanText(raw?.place, LIMITS.place);
    const audience = MOMENTS_AUDIENCES.includes(raw?.audience) ? raw.audience : '';
    const question = cleanText(raw?.question, LIMITS.question);
    const authorBio = cleanText(raw?.authorBio, LIMITS.authorBio);
    const column = cleanText(raw?.column, LIMITS.column);
    // ask：知乎里用户自己提的问题（正文是补充说明），不是回答。只认 true，且必须带 question。
    const ask = raw?.ask === true && !!question;
    return {
        ...(likers.length ? { likers } : {}), ...(place ? { place } : {}), ...(audience ? { audience } : {}),
        ...(question ? { question } : {}), ...(authorBio ? { authorBio } : {}), ...(ask ? { ask } : {}), ...(column ? { column } : {}),
    };
}

const isCleanText = (value, max) => typeof value === 'string' && value.length > 0 && value === value.trim() && Array.from(value).length <= max;

// v3 严格校验：返回第一个不合规的 [字段名, 说明]，全部合规返回 null。由调用方带上版本标签抛错。
export function findB2PostFieldError(raw) {
    if (Object.hasOwn(raw, 'likers')) {
        if (!Array.isArray(raw.likers) || raw.likers.length > MOMENTS_LIKERS_MAX) return ['post.likers', `必须是不超过 ${MOMENTS_LIKERS_MAX} 项的数组`];
        if (raw.likers.some(name => !isCleanText(name, LIMITS.liker))) return ['post.likers', '每项必须是已去首尾空白的非空字符串'];
        if (new Set(raw.likers).size !== raw.likers.length) return ['post.likers', '不能有重复的名字'];
    }
    for (const key of ['place', 'question', 'authorBio', 'column']) {
        if (Object.hasOwn(raw, key) && !isCleanText(raw[key], LIMITS[key])) return [`post.${key}`, `必须是不超过 ${LIMITS[key]} 字的非空字符串`];
    }
    if (Object.hasOwn(raw, 'audience') && !MOMENTS_AUDIENCES.includes(raw.audience)) return ['post.audience', `必须是 ${MOMENTS_AUDIENCES.join('、')} 之一`];
    if (Object.hasOwn(raw, 'ask') && (raw.ask !== true || !Object.hasOwn(raw, 'question'))) return ['post.ask', '只能是 true，且必须同时有 question'];
    return null;
}
