export const TIEBA_PROMPT = Object.freeze({
    label: '贴吧',
    defaultStyle: '像百度贴吧：口语、直白、接梗快，标题抓眼球，楼层里有附和、抬杠和楼中楼对线，楼主会回来更新。',
    feedGuide: '每条是一个贴吧主题帖。只有 2-3 条写完整正文和 4-6 层楼，其余帖子的 content 写一两句开头，comments 可以为空数组。楼层可以回复前面某一层（楼中楼），此时 quote 写被回复那层的作者名。楼主回帖时 author 与帖子作者相同。贴吧常见的口头禅可以有，但不要照抄现成的套话。',
    feedFields: 'items 为 5-8 条，字段为 author、title（不超过 30 字，不加书名号和序号）、content、flag（可选，"pinned" 表示置顶、"featured" 表示精品，pinned 全批最多 1 条）、comments（数组，每项为 author、content，以及可选的 quote，值为被回复楼层的作者名）。',
    commentGuide: '像贴吧楼层：口语、接梗、抬杠，也有认真回答的；可以回复前面的楼层（楼中楼）。楼主回帖时 author 与帖子作者相同。',
    commentFields: 'items 为 4-8 条，字段为 author、content、quote（可选，被回复楼层的作者名）。',
    liveTone: '像吧友挂在直播间刷屏：弹幕短、爱接梗、互相调侃。',
});
