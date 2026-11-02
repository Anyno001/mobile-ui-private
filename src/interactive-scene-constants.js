export const INTERACTIVE_LIMITS = Object.freeze({ scenes: 12, posts: 80, comments: 40, danmaku: 240, liveRooms: 12 });
export const INTERACTIVE_ACTOR_TYPES = Object.freeze(['user', 'story', 'passerby', 'legacy']);
export const COMMUNITY_PLATFORMS = Object.freeze(['weibo', 'douban', 'review', 'confess', 'night', 'tieba', 'hupu', 'moments', 'xhs', 'zhihu', 'news']);
// 楼层式平台：帖子有标题、点开是楼层详情页、底部回复楼主（小组、贴吧、虎扑共用这套数据结构）。
export const THREAD_PLATFORMS = Object.freeze(['douban', 'tieba', 'hupu']);
// 能接收 gal 正文（IGS）社区帖子的平台；夜间来信是原创平台，IGS 没有对应的帖子。
export const IGS_SYNC_PLATFORMS = Object.freeze(['weibo', 'douban', 'review', 'confess', 'tieba', 'hupu', 'moments', 'xhs', 'zhihu', 'news']);
// 朋友圈可见范围：缺省为公开，不存键。
export const MOMENTS_AUDIENCES = Object.freeze(['partial', 'private']);
// 朋友圈点赞名单上限。
export const MOMENTS_LIKERS_MAX = 12;
// 「与 gal 前端联动」设置（localStorage）。
export const IGS_LINK_STORAGE_KEY = 'ST_SMS_IGS_LINK';
export const COMMUNITY_POST_FLAGS = Object.freeze(['pinned', 'featured', 'help']);
export const LIVE_DANMAKU_KINDS = Object.freeze(['chat', 'host', 'gift', 'system']);
export const PHONE_UI_PAGES = Object.freeze(['desktop', 'chat', 'community', 'calendar', 'today-trend', 'story-oracle', 'live', 'gallery', 'shop', 'origin', 'greenlin']);
export const PHONE_UI_TABS = Object.freeze(['feed']);

const PRESET_PLATFORMS = Object.freeze({
    weibo: 'weibo', douban: 'douban', book: 'review', romance: 'confess', mature: 'night',
});

export function platformForPreset(preset) {
    return Object.hasOwn(PRESET_PLATFORMS, preset) ? PRESET_PLATFORMS[preset] : 'douban';
}
