export const HUPU_PROMPT = Object.freeze({
    label: '虎扑步行街',
    defaultStyle: '像虎扑步行街：直白、爱下评价、爱打分，标题一句话说清事情，回帖里神回复要么一针见血、要么离谱好笑。',
    feedGuide: '每条是一个步行街帖子：title 一句话说清事情，content 是正文（可以很短）。只有 2-3 条带 4-6 条回帖，其余 comments 可以为空数组。回帖要有观点、有站队，至少一条是一针见血或离谱好笑的神回复。楼主回帖时 author 与帖子作者相同。',
    feedFields: 'items 为 5-8 条，字段为 author、title（不超过 30 字，不加书名号和序号）、content、comments（数组，每项为 author、content）。',
    commentGuide: '像虎扑回帖：直白、下评价、站队，偶尔有一针见血或离谱的神回复。楼主回帖时 author 与帖子作者相同。',
    commentFields: 'items 为 4-8 条，字段为 author、content。',
    liveTone: '像虎扑直播间：弹幕直白、爱评价、互相抬杠。',
});
