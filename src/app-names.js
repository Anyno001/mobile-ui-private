// 界面上显示的 App 名与小标语，只在这一处定义，以后改名只改这里。
// 只用于界面显示。给 AI 的提示词里继续写真名（见 prompts/interactive/*），AI 才知道要模仿哪家的语感；
// 用户自己起的社区名照旧，不走这张表。
export const APP_NAMES = Object.freeze({
    weibo: Object.freeze({ name: '瓜博', slogan: '今天也有新瓜' }),
    douban: Object.freeze({ name: '逗瓣', slogan: '组员都很会说' }),
    review: Object.freeze({ name: '书评', slogan: '打分请手下留情' }),
    confess: Object.freeze({ name: '表白墙', slogan: '捞一下那个穿白卫衣的' }),
    night: Object.freeze({ name: '夜间来信', slogan: '四点封箱，过时不候' }),
    live: Object.freeze({ name: '噼哩噼哩', slogan: '（゜-゜）つロ 干杯' }),
    // 以下平台暂未接入界面，先登记。
    tieba: Object.freeze({ name: '贴贴吧', slogan: '前排贴贴' }),
    hupu: Object.freeze({ name: '虎噗', slogan: '步行街今天又吵起来了' }),
    moments: Object.freeze({ name: '盆友圈', slogan: '仅三天可见' }),
    xhs: Object.freeze({ name: '小红薯', slogan: '姐妹们谁懂啊' }),
    zhihu: Object.freeze({ name: '吱乎', slogan: '谢邀，人在现场' }),
    news: Object.freeze({ name: '今日猴条', slogan: '震惊！' }),
    shop: Object.freeze({ name: '桃宝', slogan: '亲，包邮哦' }),
    origin: Object.freeze({ name: '金手指', slogan: '宿主，今天也要变强哦' }),
    greenlin: Object.freeze({ name: '格林推演', slogan: '世界后台' }),
});

export const appNameOf = key => APP_NAMES[key]?.name || String(key || '');
export const appSloganOf = key => APP_NAMES[key]?.slogan || '';
