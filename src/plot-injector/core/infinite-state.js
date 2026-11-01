import { hubWordNames, resolveHub } from './infinite.js';

// 无限流状态块：正文 AI 每次回复末尾写（以默认的「末班车」配置为例，标签、栏名、词都可在项目里改）
//   <末班车状态>
//   列车：车上 / 停站 / 世界里 / 回到列车
//   污染：档名（数值）        ← 注入器不读
//   </末班车状态>
// 注入器只读主空间那一栏，读到「出发」词时开副本，读到「返回」词时关副本。纯函数，不改入参。
// 所有函数的 config 参数是 project.infinite.config（或其中的主空间部分），缺省用默认配置。

// 四个状态的显示名（按配置算出）：每组词的第一个。顺序固定为 hub、depart、away、back。
export function trainStates(config) {
    const names = hubWordNames(config);
    return [names.hub, names.depart, names.away, names.back];
}

// 正文 AI 会自由发挥，所以读得宽松：
// - 标签：容许空格、属性、全角尖括号，缺了收尾标签就读到全文末尾
// - 栏名：配置里的栏名都认；找不到栏名就读整块（去掉污染那一行）
// - 值：按同义词归到四个状态，前面紧挨着「未/没/不/尚未/还没」的不算
const POLLUTION_LINE = /^[ \t　]*污染[^\n]*$/gm;
const NEGATION = /(?:未|没|不|尚未|还没|还未)$/;

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

// 标签和栏名的正则按配置拼出来，配置里的文字先转义。
function patterns(hub) {
    const tag = escapeRegExp(hub.blockTag);
    const fields = hub.fieldNames.map(escapeRegExp).join('|');
    return {
        open: new RegExp(`[<＜]\\s*${tag}[^>＞]*[>＞]`, 'g'),
        close: new RegExp(`[<＜]\\s*\\/\\s*${tag}\\s*[>＞]`),
        line: new RegExp(`^[ \\t　]*(?:${fields})[^:：\\n]{0,6}[:：](.*)$`, 'm'),
    };
}

function hasWord(value, word) {
    let at = value.indexOf(word);
    while (at >= 0) {
        if (!NEGATION.test(value.slice(Math.max(0, at - 2), at))) return true;
        at = value.indexOf(word, at + 1);
    }
    return false;
}

// 按 back、depart、away、hub 的优先级逐组匹配，每组内按词的顺序；匹配到的词从文字里抹掉，免得「回到车上」又被「车上」算一次。
// 命中三组及以上，多半是照抄了模板，不认。返回命中那一组的显示名。
export function classifyTrainValue(value, config) {
    const hub = resolveHub(config);
    let text = String(value || '');
    const hits = [];
    for (const key of ['back', 'depart', 'away', 'hub']) {
        let hit = false;
        for (const word of hub.words[key]) {
            if (hasWord(text, word)) hit = true;
            text = text.split(word).join('　');
        }
        if (hit) hits.push(hub.words[key][0]);
    }
    return hits.length && hits.length < 3 ? hits[0] : '';
}

// 取最后一个状态块，归到四个状态之一（返回显示名）；读不出来返回 ''。
export function parseTrainState(text, config) {
    const hub = resolveHub(config);
    const re = patterns(hub);
    const src = String(text || '');
    const opens = [...src.matchAll(re.open)];
    if (!opens.length) return '';
    const last = opens[opens.length - 1];
    let body = src.slice(last.index + last[0].length);
    const close = re.close.exec(body);
    if (close) body = body.slice(0, close.index);
    const line = re.line.exec(body);
    return classifyTrainValue(line ? line[1] : body.replace(POLLUTION_LINE, ''), config);
}

// 漏写了中间那一步也认：主空间里直接读到「在副本里」算开副本，副本里直接读到「在主空间」算关副本。
function enterStates(config) {
    const names = hubWordNames(config);
    return [names.depart, names.away];
}

function leaveStates(config) {
    const names = hubWordNames(config);
    return [names.back, names.hub];
}

// FNV-1a 32 位，只用来判断「这一楼文字有没有变」。
export function hashText(text) {
    let h = 0x811c9dc5;
    const s = String(text || '');
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

// 该不该动作：主空间里读到「出发」或「在副本里」开副本；副本里读到「返回」或「在主空间」关副本；其余不动。
export function decideTrigger(phase, state, config) {
    if (phase === 'train' && enterStates(config).includes(state)) return 'enter';
    if (phase === 'world' && leaveStates(config).includes(state)) return 'leave';
    return '';
}

// 触发记录：kind 是 enter/leave，floor 是触发楼序号，hash 是当时这一楼文字的哈希，worldId 是开/关的那份档案。
export function makeTrigger({ kind, floor, text, worldId = '' }) {
    return { kind, floor: Number(floor), hash: hashText(text), worldId: String(worldId || '') };
}

// 触发楼现在怎么样。text 为 null 表示这一楼已不存在（删楼）。
//   undo：触发楼没了或不再带触发值，需要撤销；
//   same：文字没变；
//   keep：文字变了但仍带触发值，不重复生成，只更新哈希。
export function judgeTrigger(trigger, text, config) {
    if (!trigger) return 'none';
    if (text == null) return 'undo';
    const want = trigger.kind === 'enter' ? enterStates(config) : leaveStates(config);
    if (!want.includes(parseTrainState(text, config))) return 'undo';
    return hashText(text) === trigger.hash ? 'same' : 'keep';
}

export function describeRead(read, config) {
    if (!read) return '最新一楼没有状态块';
    return read.state ? `上次读到：第 ${read.floor} 楼 ${resolveHub(config).hubName}：${read.state}` : '最新一楼没有状态块';
}
