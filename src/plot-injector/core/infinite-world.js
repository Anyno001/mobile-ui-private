// 无限流：造世界。默认规范只是占位，项目里可编辑（infinite.spec 非空即覆盖默认）。
// AIRP 里 AI 本身就是 KP，档案整份注入正文，不分公开和隐藏。
export const DEFAULT_WORLD_SPEC = [
    '你是无限流恐怖故事的世界设计师。主空间把门开向某个世界，你要为这一站写一份世界档案。',
    '整份档案会完整注入正文，之后整个副本期间原样不动，由正文 AI 照着主持。',
    '骰子结果已经由脚本掷定，不可更改，档案必须以它们为准。',
    '原则：少写禁令，多写因果；违反因果不判死，只让事态变坏；线索写成实物并钉在具体地点上，到了才呈现。',
    '按下面的小节依次写，每节用小标题：',
    '外观：这个世界看起来、听起来、闻起来是什么样。',
    '委托：委托人是谁，要送的餐是什么。',
    '卡住的事：这个世界里一直解决不了的事。',
    '因果：这个世界的运转方式，一两条固定因果。',
    '线索：地点→实物→能证明什么，每条一行。',
    '离开这个世界的出口：样子、位置、出现条件、消失时机。',
    '周期证据：能推出重置周期的证据。',
    '居民认知：居民知道什么、不知道什么。',
    '真相：事件的来龙去脉。',
].join('\n');

export const WORLD_FORMAT = [
    '严格按下面的格式输出，两段标题各占一行，不要加其他说明：',
    '【标题】世界名（不超过十个字）',
    '【档案】',
    '（档案正文，按上面的小节依次写）',
].join('\n');

export function worldSpecText(infinite) {
    return String((infinite && infinite.spec) || '').trim() || DEFAULT_WORLD_SPEC;
}

function diceLines(dice) {
    return [
        `恐怖类型：${dice.horror}`,
        `重置周期：${dice.cycle}`,
        `委托人身份：${dice.client}`,
        `情欲浓度：${dice.lust}（系统会把这一项附在档案末尾，档案正文里不用重复写；为「无」时不要安排情色内容）`,
    ];
}

// 恐怖类型写法条目的标题：前缀（config.horrorPrefix）加掷出的恐怖类型，如「🎭 恐怖类型：中式民俗」。
export function horrorTitle(prefix, horror) {
    return `${String(prefix || '')}${horror}`;
}

// titles：已有世界标题，避免重复；hint：上一次解析失败的原因，重试时带上；
// horrorGuide：角色卡世界书里同标题条目的正文，找不到就不传。这些条目只给造世界用，不进正文注入。
export function buildWorldMessages({ spec, dice, setting = '', titles = [], hint = '', horrorGuide = '' }) {
    const system = `${spec}\n\n${WORLD_FORMAT}`;
    const user = [
        '【骰子结果（不可更改）】',
        ...diceLines(dice),
        titles.length ? `【已有世界（不要重复）】${titles.join('、')}` : '',
        setting ? `【主空间常驻规则】\n${setting}` : '',
        horrorGuide ? `【本世界恐怖类型写法】\n${horrorGuide}` : '',
        hint ? `【上次输出的问题】${hint}\n请按格式重写。` : '',
    ].filter(Boolean).join('\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const MARK = /^[\s#*>\-]*[【\[]\s*(标题|档案)\s*[】\]][:：]?\s*(.*)$/;

// 解析失败抛错，错误信息直接作为重试提示。
export function parseWorldReply(text) {
    const parts = { 标题: [], 档案: [] };
    let key = '';
    for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
        const hit = MARK.exec(line);
        if (hit) {
            key = hit[1];
            if (hit[2].trim()) parts[key].push(hit[2].trim());
        } else if (key) {
            parts[key].push(line);
        }
    }
    const body = parts.档案.join('\n').trim();
    if (!body) throw new Error('缺少【档案】部分');
    const title = parts.标题.join(' ').trim().slice(0, 30) || '无名之站';
    return { title, body };
}
