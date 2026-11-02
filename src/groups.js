/** 群成员标识色：只画在名字前的小圆点上，气泡保持主题默认色。 */
export const GROUP_COLORS = [
    '#f2789b', '#6f9be8', '#a487e6', '#f0a35e', '#4fbfa5',
    '#e8807a', '#5fb3d9', '#d77fc8', '#e0b84f', '#8a9fd6',
];

// 旧版按气泡底色配的浅色默认值，存进群设置的那些读出时换成同序号的新色。
const LEGACY_BUBBLE_COLORS = [
    '#e9e9eb', '#b8e6c8', '#f5d0d0', '#d4d0f5', '#f5e6b8', '#cceef5', '#ffd6a5', '#d0f0e8',
    '#f0d4f5', '#fce4b8', '#c8dff5', '#f5d4e4', '#d4efd4', '#f5e0c8', '#c8c8f5',
];

export function defaultGroupColor(index) {
    return GROUP_COLORS[index % GROUP_COLORS.length];
}

export function groupDotColor(color, fallbackIndex = 0) {
    if (typeof color !== 'string' || !color) return defaultGroupColor(fallbackIndex);
    const legacyIndex = LEGACY_BUBBLE_COLORS.indexOf(color.toLowerCase());
    return legacyIndex >= 0 ? defaultGroupColor(legacyIndex) : color;
}

export function groupDotSvg(color) {
    return `<span class="pm-group-dot" aria-hidden="true"><svg viewBox="0 0 8 8" width="100%" height="100%"><circle cx="4" cy="4" r="4" fill="${color}"/></svg></span>`;
}

/** 消息里的成员名用：返回只含圆点 SVG 的元素，供 prepend 到名字前。 */
export function createGroupDot(color) {
    const dot = document.createElement('span');
    dot.className = 'pm-group-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.innerHTML = `<svg viewBox="0 0 8 8" width="100%" height="100%"><circle cx="4" cy="4" r="4" fill="${color}"/></svg>`;
    return dot;
}
