// 文字替换：AI 输出落库前统一替换，显示时不再处理。规则存 localStorage，查找支持普通文本或 /正则/标志。
export const TEXT_REPLACE_KEY = 'ST_SMS_TEXT_REPLACE';
export const MAX_TEXT_REPLACE_RULES = 100;

const REGEX_LITERAL = /^\/([\s\S]+)\/([a-z]*)$/;
let cachedRules = null;

export function normalizeTextReplaceRules(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_TEXT_REPLACE_RULES)
        .filter(rule => rule && typeof rule === 'object')
        .map(rule => ({ find: String(rule.find ?? ''), replace: String(rule.replace ?? ''), enabled: rule.enabled !== false }));
}

/** 编译单条规则；查找为空或正则非法时返回 null。 */
export function compileTextReplaceRule(rule) {
    if (!rule || rule.enabled === false) return null;
    const find = String(rule.find ?? '');
    if (!find) return null;
    const literal = REGEX_LITERAL.exec(find);
    if (!literal) return { text: find, replace: String(rule.replace ?? '') };
    try {
        const flags = literal[2].includes('g') ? literal[2] : `${literal[2]}g`;
        return { regex: new RegExp(literal[1], flags), replace: String(rule.replace ?? '') };
    } catch (error) { return null; }
}

export function loadTextReplaceRules() {
    try { cachedRules = normalizeTextReplaceRules(JSON.parse(globalThis.localStorage?.getItem(TEXT_REPLACE_KEY))); }
    catch (error) { cachedRules = []; }
    return cachedRules;
}

export function saveTextReplaceRules(rules) {
    const next = normalizeTextReplaceRules(rules);
    try { globalThis.localStorage.setItem(TEXT_REPLACE_KEY, JSON.stringify(next)); }
    catch (error) { return false; }
    cachedRules = next;
    return true;
}

export function applyTextReplace(text, rules = cachedRules || loadTextReplaceRules()) {
    if (typeof text !== 'string' || !text || !rules?.length) return text;
    let result = text;
    for (const rule of rules) {
        const compiled = compileTextReplaceRule(rule);
        if (!compiled) continue;
        try {
            result = compiled.regex
                ? result.replace(compiled.regex, compiled.replace)
                : result.split(compiled.text).join(compiled.replace);
        } catch (error) { /* 单条规则出错不影响其余规则 */ }
    }
    return result;
}
