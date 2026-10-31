// 粗估：中日韩字符约 1 token/字，其余约 4 字符 1 token。酒馆分词器可用时由宿主层替换。
export function estimateTokens(text) {
    const value = String(text || '');
    const cjk = (value.match(/[　-鿿가-힯＀-￯]/g) || []).length;
    return Math.ceil(cjk + (value.length - cjk) / 4);
}
