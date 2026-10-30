export const ZHIHU_PROMPT = Object.freeze({
    label: '知乎',
    defaultStyle: '像知乎问答：问题具体，回答有观点、有亲身经历，开头常用「谢邀」「利益相关」「先说结论」；评论区有追问和反驳。',
    feedGuide: '每条是一个回答，question 是它回答的问题。全批围绕 2-3 个问题，每个问题 1-3 个回答，同一问题的 question 文字完全一致。回答要有观点、有经历，彼此可以不同意。authorBio 是答主的一句身份介绍。comments 是这条回答下的评论，有追问和反驳。',
    feedFields: 'items 为 4-6 条，字段为 author、authorBio（不超过 20 字）、question（问题，不超过 50 字，以问号结尾）、content（回答正文，100-400 字）、comments（0-4 条，每项为 author、content）。',
    commentGuide: '像知乎评论区：追问细节、补充经历、抬杠或反驳，语气比回答更随意。',
    commentFields: 'items 为 3-6 条，字段为 author、content。',
    liveTone: '像知乎直播：弹幕爱提问，会追问细节和数据。',
});
