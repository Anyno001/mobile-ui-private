export const MOMENTS_PROMPT = Object.freeze({
    label: '朋友圈',
    defaultStyle: '像微信朋友圈：熟人圈子，生活碎片配一句话，口吻私人、随手；评论是好友之间的接话，谁给谁评论本身就是剧情。',
    feedGuide: '每条是一条朋友圈动态。作者只写熟人：known_actor_names_data 里的剧情角色和他们的共同好友，不出现路人网友。content 是配文，一两句即可。少数动态带配图描述。likers 是点赞好友的名字，comments 是好友评论，可以互相回复：回复某人时 quote 写被回复者的名字。',
    feedFields: 'items 为 4-6 条，字段为 author、content（不超过 140 字）、place（可选，定位，不超过 20 字）、audience（可选，"partial" 表示部分可见、"private" 表示仅自己可见，公开时不写）、likers（点赞名单，0-8 个名字）、image（可选，配图的画面描述，不超过 60 字）、comments（0-5 条，每项为 author、content，以及可选的 quote，值为被回复者的名字）。',
    commentGuide: '像朋友圈好友评论：熟人口吻，短，常接前一条的话。回复某人时 quote 写被回复者的名字。',
    commentFields: 'items 为 3-6 条，字段为 author、content、quote（可选，被回复者的名字）。',
    liveTone: '像好友围观直播：弹幕亲昵，互相点名调侃。',
});
