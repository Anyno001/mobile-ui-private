import { dataBlock } from './shared.js';

// 用户在社区发帖或评论后的即时回应指令，走 comment_batch。平台名仍写真名，AI 才知道模仿哪家的语感。
// respondTo: { type: 'post' | 'comment', author, content, replyOwner?: boolean }
const POST_TASKS = Object.freeze({
    weibo: '用户刚发了一条新微博（见 respond_data）。生成 3-6 条评论，像转评区：有附和、抖机灵、站队和追问，语气各不相同。可以有 1 条带转发口吻，把内容写成「转发微博：……」或「//@某人：……」的形式。',
    douban: '用户刚发了一篇新帖子（见 respond_data）。生成 3-5 层楼层回复：有补充、追问和不同看法。可以引用楼主，此时 quote 写楼主的名字；也可以引用前面已回复的人。',
    review: '用户刚发了一篇新书评（见 respond_data）。生成 2-4 条短评，围绕这本书和这篇书评回应或反驳，每条必须带 rating（1-5 的整数星级），星级要有分歧，不要都打高分。',
    confess: '用户刚在树洞里写下一条心事（见 respond_data）。生成 2-4 条回应：有安慰、过来人的建议、共鸣，也可以有一两句轻松的吐槽，不评判、不说教。',
    night: '用户刚投进信箱一封信（见 respond_data）。生成 1-3 封回信，每封是写给这位写信人的短信，口吻像深夜里读到信的陌生人，各有各的角度。',
    tieba: '用户刚在贴吧发了一个主题帖（见 respond_data）。生成 3-5 层楼：有附和、抬杠、接梗和认真回答。可以回复前面的楼层（楼中楼），此时 quote 写被回复那层的作者名。',
    hupu: '用户刚在步行街发了一个帖子（见 respond_data）。生成 3-5 条回帖：直白、下评价、站队，至少一条一针见血或离谱好笑。',
    moments: '用户刚发了一条朋友圈（见 respond_data）。生成 2-4 条好友评论：熟人口吻，作者是剧情角色或共同好友，不出现陌生网友。可以有人接前一条评论的话，此时 quote 写被回复者的名字。',
    xhs: '用户刚发了一篇小红书笔记（见 respond_data）。生成 3-5 条评论：热情、追问细节、求后续或种草，偶尔有不同意见。',
    zhihu: '用户刚在知乎回答了一个问题（见 respond_data）。生成 2-4 条评论：追问细节、补充经历、抬杠或反驳。',
    news: '这条新闻刚发布（见 respond_data）。生成 3-5 条网友评论：立场各异，有分析、吐槽和抖机灵。',
});

const POST_FIELDS = Object.freeze({
    weibo: 'items 字段为 author、content。',
    douban: 'items 字段为 author、content、quote（可选，被引用楼层的作者名）。',
    review: 'items 字段为 author、content、rating（1-5 的整数）。',
    confess: 'items 字段为 author、content。',
    night: 'items 字段为 author、content。',
    tieba: 'items 字段为 author、content、quote（可选，被回复楼层的作者名）。',
    hupu: 'items 字段为 author、content。',
    moments: 'items 字段为 author、content、quote（可选，被回复者的名字）。',
    xhs: 'items 字段为 author、content。',
    zhihu: 'items 字段为 author、content。',
    news: 'items 字段为 author、content。',
});

// 知乎提问：用户发的是问题，回应生成回答，每条回答另成一篇帖子（见 interactive-scene-respond-flow.js）。
const ZHIHU_ASK_TASK = '用户刚在知乎提了一个问题（见 respond_data，content 是问题与补充说明）。生成 2-3 个回答：每个回答观点不同，有经历或依据，开头可以用「谢邀」「利益相关」「先说结论」一类说法。items 字段为 author、authorBio（答主的一句身份介绍，不超过 20 字）、content（回答正文，80-300 字）。';

// 能引用楼层的平台：小组的引用、贴吧的楼中楼、朋友圈的「A 回复 B」都用 quote 写被引用者的名字。
const QUOTE_PLATFORMS = Object.freeze(['douban', 'tieba', 'moments']);

function commentTask(platform, respondTo) {
    const base = platform === 'news'
        ? '用户在这条新闻下发表了评论（见 respond_data）。生成 1-3 条其他网友的接话，媒体不回复评论。'
        : respondTo.replyOwner === true
            ? '用户回复了帖子作者（见 respond_data）。生成 1-3 条接话：帖子作者可能回应用户，其他人也可能插话。'
            : '用户在这篇帖子下发表了评论（见 respond_data）。生成 1-3 条接话：帖子作者可能回应用户，其他人也可能插话。';
    const quote = QUOTE_PLATFORMS.includes(platform) ? '接话要用 quote 写出用户的名字，表示引用用户那条。' : '';
    const fields = QUOTE_PLATFORMS.includes(platform)
        ? 'items 字段为 author、content、quote（可选，被引用楼层的作者名）。'
        : platform === 'review' ? 'items 字段为 author、content、rating（可选，1-5 的整数）。' : 'items 字段为 author、content。';
    return `${base}${quote}${fields}`;
}

export function buildRespondTask(platform, respondTo) {
    const kind = respondTo?.type === 'comment' ? 'comment' : 'post';
    const author = String(respondTo?.author || '用户').trim().slice(0, 80);
    const task = kind === 'comment'
        ? commentTask(platform, respondTo)
        : platform === 'zhihu' && respondTo?.ask === true ? ZHIHU_ASK_TASK
            : `${POST_TASKS[platform] || POST_TASKS.douban}${POST_FIELDS[platform] || POST_FIELDS.douban}`;
    const block = dataBlock('respond_data', JSON.stringify({
        kind, author, content: String(respondTo?.content || '').slice(0, 1000),
    }), 1400);
    const rules = `写作者 ${author} 是用户本人，评论里不得以这个名字发言，也不要替用户说话或描写用户的反应。其余作者另起符合平台与世界观的网名。`;
    return `${task}\n${rules}\n${block}`;
}
