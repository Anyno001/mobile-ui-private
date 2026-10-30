export const NEWS_PROMPT = Object.freeze({
    label: '今日头条',
    defaultStyle: '像今日头条新闻客户端：标题醒目，导语交代事实，正文客观、公事公办；评论区是路人网友，立场各异，热评有梗。',
    feedGuide: '每条是一篇新闻。author 写媒体名（如某某日报、某某晚报、本地生活号），不写个人。title 是新闻标题，content 第一段是导语，之后是正文。column 是栏目。新闻围绕世界观里正在发生的事，可以报道剧情角色的公开动向。评论区由路人网友组成，不出现媒体本身。',
    feedFields: 'items 为 4-6 条，字段为 author（媒体名）、title（不超过 30 字）、column（栏目，如社会、娱乐、本地、财经、突发，不超过 6 字）、content（导语一段加正文，100-400 字，段落用换行分开）、image（可选，新闻配图的画面描述，不超过 40 字）、comments（0-5 条，每项为 author、content）。',
    commentGuide: '像新闻评论区：路人网友，立场各异，有理性分析、阴阳怪气和抖机灵。',
    commentFields: 'items 为 3-6 条，字段为 author、content。',
    liveTone: '像新闻直播间：弹幕关心事态进展，也有吃瓜和抬杠。',
});
