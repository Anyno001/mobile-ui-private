// 交给数据库生图写词的画面描述。照抄 IGS generated-images/external-prompt-reference.js：
// 描述后面接【角色设定】，写词 LLM 把 DNA 落成本人的英文正负向词。

const text = value => typeof value === 'string' ? value.trim() : '';
export const DNA_FRAMES = Object.freeze({ full_body: '全身', half_body: '半身', portrait: '头像' });
const DATA_RULES = [
    '按角色名逐一对应使用本人的外貌、排除项、性格和当前衣装，将所列设定逐项落实为该角色的绘图提示词；缺省细节结合当前来源的角色设定补齐。',
    '按本图取景将所给外貌中的可见特征写入本人正向词；已有英文标签和权重逐字保留，中文设定转成准确的英文绘图标签。',
    '排除标签写入本人负向词；使用整图负向格式的来源将其统一写入整图负向。',
    '每张图的固定外貌和当前衣装在表情、眼神与动作变化中保持一致，穿着按本次衣装的名称和说明描写；性格结合画面情绪，分别表现为眼神、嘴型、手势和身体姿态。',
    '只画画面里实际出现的人；列出资料但本图没有出现的角色不画。',
    '交付内容为可直接用于出图的完整提示词，按当前来源约定的字段与格式直接输出。',
];

function characterLines(character, framing) {
    const dna = character?.dna || {};
    const available = Object.keys(DNA_FRAMES).filter(key => text(dna.views?.[key]?.subject));
    const fallback = framing === 'portrait' ? ['half_body', 'full_body'] : ['full_body', 'half_body', 'portrait'];
    const selected = available.includes(framing) ? framing : fallback.find(key => available.includes(key));
    const lines = [];
    if (selected) {
        const view = dna.views[selected];
        const partial = selected !== framing && DNA_FRAMES[framing] ? `（本次${DNA_FRAMES[framing]}只取可见特征）` : '';
        lines.push(`${DNA_FRAMES[selected]}外貌${partial}：\n${text(view.subject)}`);
        if (text(view.negative)) lines.push(`身份排除项：\n${text(view.negative)}`);
    } else {
        for (const [key, label] of [['identity', '外貌'], ['triggerWords', '角色触发词（写入本人正向）'], ['negative', '身份排除项']]) {
            if (text(dna[key])) lines.push(`${label}：\n${text(dna[key])}`);
        }
    }
    if (text(dna.personality)) lines.push(`性格：\n${text(dna.personality)}`);
    const outfit = character?.outfit;
    if (text(outfit?.name) || text(outfit?.description)) {
        lines.push(`当前衣装${text(outfit.name) ? `「${text(outfit.name)}」` : ''}：\n${text(outfit.description) || '按本套衣装名称补足穿着细节。'}`);
    }
    return lines.length ? [`角色「${text(character.characterKey)}」`, ...lines].join('\n') : '';
}

export function phoneImageDescription(description, characters = [], { framing = 'half_body' } = {}) {
    const body = text(description);
    if (!body) return '';
    const blocks = (Array.isArray(characters) ? characters : []).map(character => characterLines(character, framing)).filter(Boolean);
    return blocks.length ? [body, `【角色设定】\n${DATA_RULES.join('\n')}`, ...blocks].join('\n\n') : body;
}

/** 聊天图片的画面说明：原描述 + 谁拍/谁发。 */
export function chatImageScene({ description, sender, userName, fromUser }) {
    const desc = text(description);
    const who = fromUser ? (text(userName) || '我') : text(sender);
    return who ? `手机里的一张照片：${desc}。这张照片由「${who}」发出。` : `手机里的一张照片：${desc}。`;
}

/** 社区配图的画面说明：原描述 + 发帖人。 */
export function communityImageScene({ description, author }) {
    const desc = text(description);
    return text(author) ? `社交平台帖子的配图：${desc}。发帖人「${text(author)}」。` : `社交平台帖子的配图：${desc}。`;
}

/** 描述里点到了谁：返回出现过的名字（按名字长度优先匹配，避免短名吞掉长名）。 */
export function namesMentioned(description, names = []) {
    let rest = text(description);
    const found = [];
    for (const name of [...new Set(names.map(text).filter(Boolean))].sort((a, b) => b.length - a.length)) {
        if (rest.includes(name)) { found.push(name); rest = rest.split(name).join(' '); }
    }
    return found;
}
