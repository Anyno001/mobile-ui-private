import { cleanResponse } from './shared/text/response.js';

export const GAL_BUBBLE_SCRIPT_ID = 'de4bc2f3-3bcf-44ae-8f50-d751ee0794b6';
export const GAL_BUBBLE_SCRIPT_NAME = '[天音正则] GAL气泡';

const GAL_BUBBLE_FIND_REGEX = '/<msg\\s+side\\s*=\\s*["\'](left|right)["\']\\s*>\\s*([^\\n(（|<>]{1,64}?)(?:\\s*[(（]\\s*([^\\n)）|<>]{1,64}?)\\s*[)）])?\\s*\\|\\s*([^<>]*?)\\s*<\\/msg>/giu';

const GAL_BUBBLE_REPLACE_STRING = '<style>.nl-gal{--nl-body:var(--SmartThemeBodyColor,#1c1c1e);--nl-muted:var(--SmartThemeQuoteColor,#6e6e73);--nl-border:rgba(90,90,100,.3);--nl-shadow:rgba(60,60,70,.06);--nl-surface:var(--SmartThemeBlurTintColor,rgba(242,242,247,.9));box-sizing:border-box;display:block;width:100%;margin:1.4rem 0;font-family:var(--mainFontFamily)}@supports (color:color-mix(in srgb,black,transparent)){.nl-gal{--nl-border:color-mix(in srgb,var(--SmartThemeBorderColor,rgba(60,60,67,.22)) 45%,transparent);--nl-shadow:color-mix(in srgb,var(--SmartThemeQuoteColor,#6e6e73) 12%,transparent)}}.nl-gal + style + .nl-gal{margin-top:.7rem}.nl-gal__name{box-sizing:border-box;display:flex;align-items:center;gap:.6rem;width:100%;padding:0 .3rem .3rem;line-height:1.3;color:var(--nl-muted);opacity:.55;overflow-wrap:anywhere}.nl-gal__name::before,.nl-gal__name::after{content:"";flex:1 1 auto;height:1px;background:linear-gradient(to right,transparent,var(--nl-muted),transparent);opacity:.5}.nl-gal__label{flex:0 0 auto;display:inline-flex;align-items:baseline;gap:.15rem;max-width:80%;overflow-wrap:anywhere}.nl-gal__nm{font-size:.74rem;font-weight:600;letter-spacing:.04em}.nl-gal__id:empty{display:none}.nl-gal__id:not(:empty){font-size:.62rem;font-weight:400;opacity:.8}.nl-gal__id:not(:empty)::before{content:"（"}.nl-gal__id:not(:empty)::after{content:"）"}.nl-gal__box{box-sizing:border-box;width:100%;padding:.7rem .95rem;border:1px solid var(--nl-border);border-radius:.5rem;background:var(--nl-surface);color:var(--nl-body);box-shadow:0 1px 5px var(--nl-shadow),inset 0 0 5px rgba(255,255,255,.02);font-size:.84rem;line-height:1.85;overflow-wrap:anywhere;word-break:break-word}.nl-gal[data-side="right"] .nl-gal__box{background:color-mix(in srgb,var(--nl-muted) 24%,var(--nl-surface))}.nl-gal__txt{display:block;white-space:pre-wrap;text-indent:1rem}@media (max-width:420px){.nl-gal__name{gap:.4rem}.nl-gal__label{max-width:90%}}</style><section class="nl-gal" data-side="$1"><div class="nl-gal__name"><span class="nl-gal__label"><span class="nl-gal__nm">$2</span><span class="nl-gal__id">$3</span></span></div><div class="nl-gal__box"><span class="nl-gal__txt">$4</span></div></section>';

export const GAL_BUBBLE_PROMPT = `# 台词格式

全程只输出消息行，无任何裸叙述或旁白。格式：

<msg side="left">名字（别名）|台词正文</msg>

## 规则
- side 只能 left 或 right。仅用户本人发送用 right，其余角色一律 left，不确定时用 left。
- 结构：名字 +（可选别名，中文全角括号）+ 半角竖线 \`|\` + 正文。
- 名字必须使用实际显示名；名字/别名可用中文、字母、数字、下划线、点、空格或连字，不得包含尖括号。
- 正文为纯文本，不加任何引号；引述他人时引号作正文自然出现。正文需竖线用全角 \`｜\`，需尖括号用 \`&lt;\` \`&gt;\`。
- 每条独立成对，标签完整不嵌套；同角色连发拆成多条，名字保持一致。
- 可以不同角色连发多条。


## 禁止
非用户本人用 right、省略 side 或结束标签、裸叙述、正文加引号、用代码块/列表/表格包裹消息、解释规则。

## 示例
<msg side="left">林夏（夏夏）|你真的打算就这么走了？</msg>
<msg side="right">YOYO|不然呢，留下来还有什么意义。</msg>`;

export const getGalBubblePrompt = enabled => enabled === true ? `\n\n${GAL_BUBBLE_PROMPT}` : '';

const GAL_BUBBLE_MESSAGE_PATTERN = /<msg\s+side\s*=\s*["'](left|right)["']\s*>\s*([^\n(（|<>]{1,64}?)(?:\s*[(（]\s*([^\n)）|<>]{1,64}?)\s*[)）])?\s*\|\s*([^<>]*?)\s*<\/msg>/giu;

const stripGalIgnorableBlocks = value => String(value || '')
    .replace(/<(?:think|thinking|reasoning|reflection|inner_thought)>[\s\S]*?<\/(?:think|thinking|reasoning|reflection|inner_thought)>/gi, '');

export function parseGalBubbleMessages(raw) {
    const source = stripGalIgnorableBlocks(typeof raw === 'string' ? raw : '');
    const messages = [];
    let consumedUntil = 0;
    let residual = '';
    let invalidMatch = false;
    let match;
    while ((match = GAL_BUBBLE_MESSAGE_PATTERN.exec(source)) !== null) {
        residual += source.slice(consumedUntil, match.index);
        consumedUntil = GAL_BUBBLE_MESSAGE_PATTERN.lastIndex;
        const name = match[2].trim();
        const text = cleanResponse(match[4]);
        if (!name || !text) {
            invalidMatch = true;
            continue;
        }
        messages.push({ side: match[1].toLowerCase(), name, text });
    }
    residual += source.slice(consumedUntil);
    if (invalidMatch || residual.trim()) return null;
    return messages.length ? messages : null;
}

export function getGalBubbleAssistantText(raw) {
    const messages = parseGalBubbleMessages(raw);
    if (!messages) return null;
    return messages.filter(message => message.side === 'left').map(message => message.text).join('\n');
}

export function getGalBubbleScriptDefinition() {
    return {
        id: GAL_BUBBLE_SCRIPT_ID,
        scriptName: GAL_BUBBLE_SCRIPT_NAME,
        findRegex: GAL_BUBBLE_FIND_REGEX,
        replaceString: GAL_BUBBLE_REPLACE_STRING,
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    };
}

function structurallyEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((value, index) => structurallyEqual(value, right[index]));
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]));
}

function hasSameDefinition(script, desired) {
    return Object.keys(desired).every(key => structurallyEqual(script[key], desired[key]));
}

function isOwnedScript(script) {
    return Boolean(script) && script.id === GAL_BUBBLE_SCRIPT_ID;
}

function getRegexList(context) {
    const settings = context?.extensionSettings;
    if (!settings) throw Object.assign(new Error('当前酒馆上下文不可用，无法访问全局正则列表'), { code: 'host-unavailable' });
    if (!Array.isArray(settings.regex)) throw Object.assign(new Error('酒馆正则模块尚未就绪，请稍后重试'), { code: 'regex-not-ready' });
    if (Array.isArray(settings.disabledExtensions) && settings.disabledExtensions.includes('regex')) {
        throw Object.assign(new Error('酒馆正则扩展已禁用，请先启用 Regex 扩展'), { code: 'regex-disabled' });
    }
    return settings.regex;
}

async function requireSave(context) {
    if (typeof context.saveSettingsDebounced !== 'function') throw Object.assign(new Error('当前酒馆未提供设置保存接口'), { code: 'save-unavailable' });
    const result = context.saveSettingsDebounced();
    if (result && typeof result.then === 'function') await result;
    if (result === false) throw Object.assign(new Error('当前酒馆设置保存接口调用失败'), { code: 'save-failed' });
}

let galBubbleMutationQueue = Promise.resolve();

async function reconcileGalBubbleNow(context, enabled) {
    const matches = getRegexList(context).filter(isOwnedScript);
    if (matches.length > 1) throw Object.assign(new Error('发现多条同 ID 的天音小笺正则，已停止修改，请先在酒馆正则面板清理重复项'), { code: 'duplicate-script' });
    if (enabled === true) return installGalBubble(context);
    if (enabled !== true && matches.length) return uninstallGalBubble(context);
    return { changed: false, action: 'noop' };
}

export function reconcileGalBubble(context, enabled) {
    const transaction = galBubbleMutationQueue.then(() => reconcileGalBubbleNow(context, enabled));
    galBubbleMutationQueue = transaction.catch(() => {});
    return transaction;
}

export async function installGalBubble(context) {
    const list = getRegexList(context);
    const matches = list.filter(isOwnedScript);
    if (matches.length > 1) throw Object.assign(new Error('发现多条同 ID 的天音小笺正则，已停止修改，请先在酒馆正则面板清理重复项'), { code: 'duplicate-script' });
    if (!matches.length) {
        const script = getGalBubbleScriptDefinition();
        list.push(script);
        try {
            await requireSave(context);
        } catch (error) {
            list.splice(list.indexOf(script), 1);
            throw error;
        }
        return { changed: true, action: 'installed' };
    }
    const script = matches[0];
    const desired = getGalBubbleScriptDefinition();
    if (hasSameDefinition(script, desired)) return { changed: false, action: 'noop' };
    const previous = { ...script };
    Object.assign(script, desired);
    try {
        await requireSave(context);
    } catch (error) {
        for (const key of Object.keys(script)) if (!Object.hasOwn(previous, key)) delete script[key];
        Object.assign(script, previous);
        throw error;
    }
    return { changed: true, action: 'updated' };
}

export async function uninstallGalBubble(context) {
    const list = getRegexList(context);
    const matches = list.filter(isOwnedScript);
    if (matches.length > 1) throw Object.assign(new Error('发现多条同 ID 的天音小笺正则，已停止修改，请先在酒馆正则面板清理重复项'), { code: 'duplicate-script' });
    if (!matches.length) return { changed: false, action: 'noop' };
    const index = list.indexOf(matches[0]);
    const [script] = list.splice(index, 1);
    try {
        await requireSave(context);
    } catch (error) {
        list.splice(index, 0, script);
        throw error;
    }
    return { changed: true, action: 'uninstalled' };
}
