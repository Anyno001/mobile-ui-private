// 内置 NAI 的写词：用手机的 API 把中文画面描述写成英文 TAG，角色外貌与衣装由程序把 DNA 硬合进去，
// 不交给模型改写（照 IGS「出图前硬合 DNA 英文 tag」的做法）。

import { parseFirstJsonObject } from './ai.js';
import { snapToGrid } from './phone-image-nai.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const joinTags = (...parts) => parts.map(p => text(p).replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ');
const FALLBACK = { full_body: ['full_body', 'half_body', 'portrait'], half_body: ['half_body', 'full_body', 'portrait'], portrait: ['portrait', 'half_body', 'full_body'] };

/** 取本次取景的外貌与排除项；缺景别按顺序借别的景别，旧版字段兼容。 */
export function dnaTags(dna, framing = 'half_body') {
    const view = (FALLBACK[framing] || FALLBACK.half_body).map(key => dna?.views?.[key]).find(v => text(v?.subject));
    if (view) return { subject: text(view.subject), negative: text(view.negative) };
    return { subject: joinTags(dna?.identity, dna?.triggerWords), negative: text(dna?.negative) };
}

export const NAI_WRITER_PROMPT = [
    '你把一张图的中文画面描述写成 NovelAI V4 的英文 Danbooru 标签。只输出 JSON，不解释。',
    '{"scene":"","chars":[{"name":"","tags":"","outfit":"","x":0.5,"y":0.5}]}',
    '- scene：人数（如 1girl, 1boy, 2girls）、构图与镜头、背景、光线、氛围。',
    '- chars：画面里出现的每个人一项。name 照抄资料里的角色名；tags 只写这一刻的表情、视线、动作、姿势和手里的东西，不写长相（程序会补上固定外貌）；outfit 把资料里的中文衣装翻成英文标签，资料没有衣装就按场景写一套合适的，写成逗号分隔的标签。',
    '- x、y 是这个人在画面中的位置，取 0.1、0.3、0.5、0.7、0.9。',
    '- 资料里列出但这张图没有出现的人不写。没有人的风景、物品照片，chars 为空数组。',
    '- 全部是逗号分隔的英文标签，不写句子，不写质量词和画师名。',
].join('\n');

export function buildNaiWriterUserPrompt(description, characters = []) {
    const rows = characters.map(c => {
        const outfit = text(c.outfit?.description) || text(c.outfit?.name);
        return `- ${text(c.characterKey)}${outfit ? `：当前衣装 ${outfit}` : ''}`;
    });
    return [`画面：${text(description)}`, rows.length ? `可能出现的人：\n${rows.join('\n')}` : ''].filter(Boolean).join('\n\n');
}

/** 模型回复 + 角色资料 → 出图 slot。资料里有的人合上 DNA；模型多写出的人（路人）只用它写的标签。 */
export function mergeNaiSlot(raw, characters = [], framing = 'half_body') {
    const data = parseFirstJsonObject(raw, '写词回复不是 JSON');
    const scene = text(data.scene);
    const byName = new Map(characters.map(c => [text(c.characterKey), c]));
    const rows = (Array.isArray(data.chars) ? data.chars : []).filter(c => c && typeof c === 'object').slice(0, 6);
    const chars = rows.map((row, index) => {
        const source = byName.get(text(row.name));
        const identity = source?.dna ? dnaTags(source.dna, framing) : { subject: '', negative: '' };
        const spread = rows.length > 1 ? 0.1 + 0.8 * index / (rows.length - 1) : 0.5;
        return {
            name: text(row.name),
            tags: joinTags(identity.subject, row.outfit, row.tags),
            uc: identity.negative,
            x: snapToGrid(Number.isFinite(Number(row.x)) ? row.x : spread),
            y: snapToGrid(Number.isFinite(Number(row.y)) ? row.y : 0.5),
        };
    }).filter(c => c.tags);
    if (!scene && !chars.length) throw new Error('写词回复没有标签');
    return { scene, chars };
}

export async function writeNaiSlot({ description, characters, framing, callAI, signal }) {
    if (typeof callAI !== 'function') throw new Error('内置生图需要先在手机设置里配置 API，用来写提示词');
    const raw = await callAI(NAI_WRITER_PROMPT, buildNaiWriterUserPrompt(description, characters), { isolated: true, signal });
    return mergeNaiSlot(raw, characters, framing);
}
