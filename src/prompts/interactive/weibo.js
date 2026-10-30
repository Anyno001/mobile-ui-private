export const WEIBO_PROMPT = Object.freeze({
    label: '微博广场',
    defaultStyle: '短句、热搜感、转评赞语气，网名与人设鲜明，表达轻快、带梗。',
    feedGuide: '从正文剧情里提炼热搜词，动态围绕这些热点展开。内容即时、有话题感，抖机灵、站队和阴阳怪气并存。1-2 条是转发：content 写转发者自己的评语，repost 写被转发的原微博。正文里的话题写成 #话题#。',
    feedFields: 'meta.hot 为 3-5 条热搜，每条为 {"title":热搜词，不超过 30 字,"badge":"沸"、"热"、"新"之一，也可为空字符串}。items 为 4-6 条，字段为 author、content（不超过 140 字）、tags（1-3 个话题词，不带 #）、comments（2-5 条，每项为 author、content）、repost（可选，{"author":原博作者,"content":原微博正文}）、image（可选，配图的画面描述，不超过 60 字；少数动态带图即可）。',
    commentGuide: '像转评区：短促、带梗，可以抖机灵、站队、阴阳怪气，彼此之间也会接话。',
    commentFields: 'items 为 4-8 条，字段为 author、content。',
    liveTone: '短、快、带梗，有刷屏感，偶尔出现「前排」「打卡」一类口吻。',
});
