import { COMMUNITY_PLATFORMS } from '../interactive-scene-constants.js';
import { FEED_PAGE_SIZE, feedLimitOf, splitTitle, validStarRating } from './view-shared.js';

// 只改会话内视图状态（state.view，不写存储）的导航与筛选动作。
export const VIEW_ACTIONS = Object.freeze([
    'set-segment', 'open-thread', 'close-thread', 'open-book', 'close-book', 'filter-mood', 'toggle-open', 'filter-tag', 'open-question', 'close-question',
    'feed-more',
]);

// 返回 true 表示重绘时保持滚动位置（展开收起、筛选）；切换分段、打开或返回时回到顶部。
export function applyViewAction(view, action, data = {}) {
    if (action === 'set-segment') Object.assign(view, { segment: data.segment || '', postId: '', work: '' });
    else if (action === 'open-thread') view.postId = data.postId || '';
    else if (action === 'close-thread') view.postId = '';
    else if (action === 'open-book') view.work = data.work || '';
    else if (action === 'close-book') view.work = '';
    else if (action === 'filter-mood') view.mood = data.mood || '';
    else if (action === 'filter-tag') view.tag = data.tag || '';
    else if (action === 'open-question') view.question = data.question || '';
    else if (action === 'close-question') view.question = '';
    else if (action === 'feed-more') view.feedLimit = feedLimitOf(view) + FEED_PAGE_SIZE;
    else if (action === 'toggle-open' && data.postId) {
        const index = view.open.indexOf(data.postId);
        if (index >= 0) view.open.splice(index, 1); else view.open.push(data.postId);
    }
    return ['toggle-open', 'filter-mood', 'filter-tag', 'feed-more'].includes(action);
}

// 发布成功：关闭编辑页、丢弃草稿；筛选回到能看见新内容的状态。
export function resetViewAfterPublish(view, platform) {
    Object.assign(view, { compose: false, draft: null, mood: '', tag: '' });
    if (platform === 'douban' || platform === 'tieba' || (platform === 'review' && !view.work)) view.segment = '';
}

// 以下几个动作只改 DOM 选中态，不进存储；发布时再从 DOM 读取。

export function pickPlatform(app, button) {
    const platform = String(button?.dataset?.platform || '');
    if (!app || !COMMUNITY_PLATFORMS.includes(platform)) return false;
    app.querySelectorAll?.('.pm-scene-platform').forEach(item => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
    });
    app.setAttribute?.('data-community-platform', platform);
    return true;
}

export function toggleNsfwSwitch(button) {
    if (!button) return false;
    const enabled = button.getAttribute?.('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(enabled));
    button.classList?.toggle('is-on', enabled);
    return enabled;
}

export function pickRating(app, button) {
    const rating = Number(button?.dataset?.rating);
    if (!app || !validStarRating(rating)) return 0;
    const selected = button.getAttribute?.('aria-pressed') === 'true' ? 0 : rating;
    app.querySelectorAll?.('.pm-scene-star').forEach(star => {
        const value = Number(star.dataset?.rating);
        star.classList.toggle('is-on', value <= selected);
        star.setAttribute('aria-pressed', String(value === selected));
    });
    return selected;
}

export function pickMood(app, button) {
    const mood = String(button?.dataset?.mood || '');
    if (!app || !mood) return '';
    const selected = button.getAttribute?.('aria-pressed') === 'true' ? '' : mood;
    app.querySelectorAll?.('.pm-scene-moods.is-picker .pm-scene-mood').forEach(item => {
        const pressed = item.dataset?.mood === selected && selected !== '';
        item.classList.toggle('is-active', pressed);
        item.setAttribute('aria-pressed', String(pressed));
    });
    return selected;
}

// 编辑页的附加字段（均已去首尾空白）；正文在 #pm-scene-post-input，由调用方单独读取。
export function readComposeUi(app) {
    const text = selector => String(app?.querySelector?.(selector)?.value || '').trim();
    return {
        title: text('#pm-scene-title-input'),
        work: text('#pm-scene-work'),
        to: text('#pm-scene-to'),
        sign: text('#pm-scene-sign-input'),
        rating: Number(app?.querySelector?.('.pm-scene-star[aria-pressed="true"]')?.dataset?.rating) || 0,
        mood: String(app?.querySelector?.('.pm-scene-moods.is-picker .pm-scene-mood[aria-pressed="true"]')?.dataset?.mood || ''),
        ...readB2ComposeUi(app, text),
    };
}

// 朋友圈的定位与可见范围、小红书话题、知乎补充说明：只在对应输入存在时带上，其余平台的结果不变。
const B2_INPUTS = Object.freeze({ place: '#pm-scene-place-input', topics: '#pm-scene-topics-input', supplement: '#pm-scene-supplement-input' });
function readB2ComposeUi(app, read) {
    const out = {};
    for (const [key, selector] of Object.entries(B2_INPUTS)) if (app?.querySelector?.(selector)) out[key] = read(selector);
    const audience = app?.querySelector?.('input[name="pm-scene-audience"]:checked');
    if (audience) out.audience = String(audience.value || '');
    return out;
}

// 草稿：编辑页当前所有输入的原样值（不去空白）。只存进 view.draft，不写存储。
// 整页重绘前读一次，编辑页重绘后输入不会丢；落款被清空时保持为空串，不回填用户名。
export function readComposeDraft(app) {
    const raw = selector => {
        const element = app?.querySelector?.(selector);
        return element ? String(element.value ?? '') : null;
    };
    const ui = readComposeUi(app);
    const draft = { text: raw('#pm-scene-post-input') ?? '', title: raw('#pm-scene-title-input') ?? '', work: raw('#pm-scene-work') ?? '', to: raw('#pm-scene-to') ?? '', rating: ui.rating, mood: ui.mood };
    const sign = raw('#pm-scene-sign-input');
    if (sign !== null) draft.sign = sign;
    for (const [key, selector] of Object.entries(B2_INPUTS)) {
        const value = raw(selector);
        if (value !== null) draft[key] = value;
    }
    if (Object.hasOwn(ui, 'audience')) draft.audience = ui.audience;
    return draft;
}

// 微博「# 话题」：在光标处插入一对 ##，光标落在两个井号之间；有选中文字时改为把它包成话题。
export function insertTopicMark(input) {
    if (!input || typeof input.value !== 'string') return false;
    const value = input.value;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    const picked = value.slice(start, end);
    input.value = `${value.slice(0, start)}#${picked}#${value.slice(end)}`;
    const caret = picked ? end + 2 : start + 1;
    input.focus?.({ preventScroll: true });
    input.setSelectionRange?.(caret, caret);
    return true;
}

// 话题输入：空格、逗号、顿号分开，去掉井号，去重，最多 3 个。
export const parseTopicInput = value => [...new Set(String(value || '').split(/[\s,，、]+/).map(tag => tag.replace(/^#+|#+$/g, '').trim().slice(0, 30)).filter(Boolean))].slice(0, 3);

// 朋友圈、小红书、知乎的附加字段；返回要合并进 fields 的键（content 可能被改写）。
function composeB2Fields(platform, content, ui, context) {
    if (platform === 'moments') {
        const place = String(ui.place || '').trim().slice(0, 40);
        return { ...(place ? { place } : {}), ...(['partial', 'private'].includes(ui.audience) ? { audience: ui.audience } : {}) };
    }
    if (platform === 'xhs') {
        const title = String(ui.title || '').trim().slice(0, 20);
        if (!title) throw new Error('请先填写标题');
        return { title, tags: parseTopicInput(ui.topics) };
    }
    if (platform === 'zhihu') {
        // 问题页里写回答：question 取当前问题。首页提问：输入框写的是问题，正文是补充说明（没写就与问题相同），并标 ask。
        if (context.view?.question) return { question: String(context.view.question).slice(0, 80) };
        const question = content.slice(0, 80);
        const supplement = String(ui.supplement || '').trim().slice(0, 1000);
        return { question, content: supplement || question, ask: true };
    }
    return {};
}

// 按平台把输入框内容和附加输入整理成帖子字段；返回值可直接交给 appendScenePosts。
// 标题由编辑页的「标题」字段给出；留空时仍取正文首行（首行不超过 40 字且后面还有正文）。
// context: { view（当前视图状态）, scene, authorName（落款默认值） }
export function composePostFields(platform, content, ui = {}, context = {}) {
    const fields = { content: String(content || '').trim(), tags: [] };
    // 新闻没有发布入口；万一被调用（例如旧草稿）也不允许用户发新闻。
    if (platform === 'news') throw new Error('新闻不能由用户发布');
    if (['douban', 'review', 'tieba', 'hupu'].includes(platform)) {
        const typed = String(ui.title || '').trim().slice(0, 40);
        if (typed) fields.title = typed;
        else {
            const { title, body } = splitTitle(fields.content);
            if (title) { fields.title = title; fields.content = body; }
        }
    }
    if (platform === 'review') {
        const work = String(context.view?.work || ui.work || '').trim().slice(0, 40);
        if (!work) throw new Error('请先填写书名');
        fields.work = work;
        const known = (context.scene?.posts || []).find(post => post.work === work && post.workAuthor);
        if (known) fields.workAuthor = known.workAuthor;
        if (validStarRating(ui.rating)) fields.rating = ui.rating;
    }
    if (platform === 'confess' && ui.mood) fields.mood = String(ui.mood).slice(0, 12);
    Object.assign(fields, composeB2Fields(platform, fields.content, ui, context));
    if (platform === 'night') {
        if (ui.to) fields.to = String(ui.to).slice(0, 20);
        const sign = String(ui.sign || context.authorName || '').trim().slice(0, 40);
        if (sign) fields.sign = sign;
    }
    return fields;
}
