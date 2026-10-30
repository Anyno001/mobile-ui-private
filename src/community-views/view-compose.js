import { EDIT_ICON_SVG, PLUS_ICON_SVG } from '../icons.js';
import { escapeAttr, escapeHtml } from '../ui.js';
import { collectMoods, renderMoodPicker } from './view-confess.js';
import { renderRatingPicker } from './view-review.js';

// 编辑页的标题与发布键文案：各平台只换字段，框架是同一个组件。
const COMPOSE_META = Object.freeze({
    weibo: { title: '发微博', submit: '发布' },
    douban: { title: '发帖', submit: '发布' },
    review: { title: '写书评', submit: '发布' },
    confess: { title: '说出心事', submit: '发布' },
    night: { title: '投一封信', submit: '投进信箱' },
});

const field = (label, control) => `<label class="pm-scene-sheet-field"><span>${escapeHtml(label)}</span>${control}</label>`;

function renderFields(platform, scene, view, draft, authorName) {
    const text = (placeholder, { large = false, focus = false } = {}) => `<textarea id="pm-scene-post-input" class="pm-scene-sheet-text${large ? ' is-large' : ''}" maxlength="4082" placeholder="${escapeAttr(placeholder)}"${focus ? ' data-compose-focus' : ''}>${escapeHtml(draft.text || '')}</textarea>`;
    if (platform === 'weibo') {
        return `${text('有什么新鲜事？', { large: true, focus: true })}<div class="pm-scene-sheet-tools"><button type="button" class="pm-scene-sheet-tool" data-action="insert-topic"># 话题</button></div>`;
    }
    if (platform === 'douban') {
        return `${field('标题', `<input id="pm-scene-title-input" class="pm-scene-sheet-input" maxlength="40" placeholder="留空则取正文首行" value="${escapeAttr(draft.title || '')}" data-compose-focus>`)}${field('正文', text('写点什么……'))}`;
    }
    if (platform === 'review') {
        const locked = !!view.work;
        // 单本页进入时书名已填好且不可改：用静态块展示，发布时取 view.work；列表页进入时是可填的输入框。
        const work = locked
            ? `<div class="pm-scene-sheet-locked" role="textbox" aria-readonly="true" aria-label="书名">${escapeHtml(view.work)}</div>`
            : `<input id="pm-scene-work" class="pm-scene-sheet-input" maxlength="40" placeholder="书名" value="${escapeAttr(draft.work || '')}" data-compose-focus>`;
        const title = `<input id="pm-scene-title-input" class="pm-scene-sheet-input" maxlength="40" placeholder="一句话概括" value="${escapeAttr(draft.title || '')}"${locked ? ' data-compose-focus' : ''}>`;
        return `<div class="pm-scene-sheet-rating">${renderRatingPicker(draft.rating)}</div>${field('书名', work)}${field('书评标题', title)}${field('正文', text('写一段书评……'))}`;
    }
    if (platform === 'confess') {
        return `<div class="pm-scene-sheet-moods">${renderMoodPicker(collectMoods(scene.posts), draft.mood)}</div>${text('悄悄说一句……', { large: true, focus: true })}`;
    }
    const sign = typeof draft.sign === 'string' ? draft.sign : authorName;
    return `${field('写给', `<input id="pm-scene-to" class="pm-scene-sheet-input" maxlength="20" placeholder="写给……" value="${escapeAttr(draft.to || '')}" data-compose-focus>`)}${field('正文', text('写一封信，投进今夜信箱'))}${field('落款', `<input id="pm-scene-sign-input" class="pm-scene-sheet-input" maxlength="40" value="${escapeAttr(sign)}">`)}`;
}

// 整页编辑页：在社区页内整页覆盖，顶栏「取消 / 标题 / 发布」。草稿只在内存里（view.draft），取消即丢弃。
export function renderComposeSheet(platform, { scene, view = {}, authorName = '' } = {}) {
    const meta = COMPOSE_META[platform] || COMPOSE_META.weibo;
    const draft = view.draft && typeof view.draft === 'object' ? view.draft : {};
    return `<div class="pm-scene-topbar pm-scene-sheet-bar"><button type="button" class="pm-scene-sheet-cancel" data-action="close-compose">取消</button><div class="pm-scene-title"><b>${escapeHtml(meta.title)}</b></div><button type="button" class="pm-scene-pill" data-action="publish">${escapeHtml(meta.submit)}</button></div><div class="pm-scene-status" aria-live="polite" hidden></div>
        <section class="pm-scene-sheet" aria-label="${escapeAttr(meta.title)}">${renderFields(platform, scene, view, draft, authorName)}</section>`;
}

// 微博右下角悬浮圆钮、树洞底部居中大胶囊：浮在信息流上方，不占一行底栏。
export function renderComposeFloat(platform) {
    if (platform === 'weibo') {
        return `<div class="pm-scene-float"><button type="button" class="pm-scene-fab" data-action="open-compose" aria-label="发微博" title="发微博">${PLUS_ICON_SVG}</button></div>`;
    }
    if (platform === 'confess') {
        return `<div class="pm-scene-float is-center"><button type="button" class="pm-scene-float-pill" data-action="open-compose"><span class="pm-scene-float-icon" aria-hidden="true">${EDIT_ICON_SVG}</span>说出你的心事</button></div>`;
    }
    return '';
}

// 夜间来信底部整宽按钮，作为一条独立的底栏放在信息流下方。
export function renderComposeDock(platform) {
    return platform === 'night' ? '<div class="pm-scene-dock"><button type="button" class="pm-scene-dock-button" data-action="open-compose">投一封信</button></div>' : '';
}
