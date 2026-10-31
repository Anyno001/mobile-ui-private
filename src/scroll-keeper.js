/**
 * 整页 innerHTML 重绘会把滚动容器换成新节点，滚动位置随之归零。
 * 重绘前按选择器记下各滚动容器的 scrollTop，重绘后按同样顺序放回；
 * 只有 sameView 为真（同一页面内的操作）时才放回，换页照常回到顶部。
 */
export function captureScroll(root, selectors) {
    if (!root?.querySelectorAll) return [];
    return selectors.map(selector => Array.from(root.querySelectorAll(selector), element => element.scrollTop || 0));
}

export function restoreScroll(root, selectors, captured) {
    if (!root?.querySelectorAll || !Array.isArray(captured)) return;
    selectors.forEach((selector, index) => {
        const positions = captured[index] || [];
        if (!positions.some(Boolean)) return;
        root.querySelectorAll(selector).forEach((element, position) => {
            if (positions[position]) element.scrollTop = positions[position];
        });
    });
}

/** render() 前后各调一次：keepScroll(root, selectors, sameView, () => { root.innerHTML = html; }) */
export function keepScroll(root, selectors, sameView, render) {
    const captured = sameView ? captureScroll(root, selectors) : null;
    const result = render();
    if (captured) restoreScroll(root, selectors, captured);
    return result;
}
