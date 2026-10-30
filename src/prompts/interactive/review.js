export const REVIEW_PROMPT = Object.freeze({
    label: '书评',
    defaultStyle: '有阅读质感，讨论文本、人物、主题与私人阅读体验，评价具体，不空泛吹捧。',
    feedGuide: '每条是一篇长评。书目必须是这个世界里合理存在的：现代世界可以使用真实书目，架空世界则编造书名与作者。星级符合真实评价分布，同批不能全是 4-5 星，也要有低分与争议。',
    feedFields: 'items 为 3-5 条，字段为 author、work（书名）、workAuthor（作者）、rating（1-5 的整数）、title（书评标题，不超过 30 字）、content、tags（1-3 个题材词）、comments（1-4 条，每项为 author、content，可带 rating）、image（可选，书封或读书场景的画面描述，不超过 60 字）。',
    commentGuide: '其他读者的短评：围绕这本书回应或反驳，可以补充自己的阅读体验。',
    commentFields: 'items 为 4-8 条，字段为 author、content、rating（可选，1-5 的整数）。',
    liveTone: '像读书会或作者分享：弹幕会提问、引用书中句子、交流读后感，偶有不同意见。',
});
