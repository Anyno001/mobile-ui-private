export const XHS_PROMPT = Object.freeze({
    label: '小红书',
    defaultStyle: '像小红书：分享笔记，标题吸睛，正文热情、有种草感和分享欲；评论区追问细节、求后续、互相安利。',
    feedGuide: '每条是一篇笔记：经验分享、探店、穿搭、好物或生活记录。title 是吸睛标题，content 是正文，tags 是话题词。image 写封面画面。评论区要热络：追问、求后续、种草和吐槽都有，小红书常见的评论口吻可以有，但不要照抄现成的套话。',
    feedFields: 'items 为 4-6 条，字段为 author、title（必填，不超过 20 字）、content（不超过 300 字）、tags（1-3 个话题词，不带 #）、image（封面的画面描述，不超过 40 字）、comments（0-5 条，每项为 author、content）。',
    commentGuide: '像小红书评论区：热情、追问细节、求链接求后续，偶尔有不同意见。',
    commentFields: 'items 为 3-6 条，字段为 author、content。',
    liveTone: '像小红书直播：弹幕热情，追问细节和链接。',
});
