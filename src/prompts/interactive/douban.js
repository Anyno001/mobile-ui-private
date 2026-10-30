export const DOUBAN_PROMPT = Object.freeze({
    label: '小组论坛',
    defaultStyle: '克制、生活化、观察细腻，标题像小组帖子，回帖有追问和真实分歧，楼主会更新进展。',
    feedGuide: '每条是一篇小组帖子。只有 2-3 条写完整正文和 3-5 条楼层，其余帖子的 content 写一两句开头，comments 可以为空数组。楼层之间可以互相引用。楼主回帖时 author 与帖子作者相同，并交代后续进展。',
    feedFields: 'items 为 5-8 条，字段为 author、title（不超过 30 字，不加书名号和序号）、content、flag（可选，"pinned"、"help"、"featured" 之一，pinned 全批最多 1 条）、comments（数组，每项为 author、content，以及可选的 quote，值为被引用楼层的作者名）。',
    commentGuide: '像楼层回复：补充、追问、提出不同看法，可引用前面的楼层。楼主回帖时 author 与帖子作者相同。',
    commentFields: 'items 为 4-8 条，字段为 author、content、quote（可选，被引用楼层的作者名）。',
    liveTone: '像组员挂在直播间闲聊：弹幕稍长，会讨论细节并互相接话，语气克制。',
});
