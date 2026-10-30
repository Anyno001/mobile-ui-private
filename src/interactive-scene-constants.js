export const INTERACTIVE_LIMITS = Object.freeze({ scenes: 12, posts: 80, comments: 40, danmaku: 240, liveRooms: 12 });
export const INTERACTIVE_ACTOR_TYPES = Object.freeze(['user', 'story', 'passerby', 'legacy']);
export const COMMUNITY_PLATFORMS = Object.freeze(['weibo', 'douban', 'review', 'confess', 'night']);
export const COMMUNITY_POST_FLAGS = Object.freeze(['pinned', 'featured', 'help']);
export const LIVE_DANMAKU_KINDS = Object.freeze(['chat', 'host', 'gift', 'system']);
export const PHONE_UI_PAGES = Object.freeze(['desktop', 'chat', 'community', 'calendar', 'today-trend', 'story-oracle', 'live', 'gallery']);
export const PHONE_UI_TABS = Object.freeze(['feed']);

const PRESET_PLATFORMS = Object.freeze({
    weibo: 'weibo', douban: 'douban', book: 'review', romance: 'confess', mature: 'night',
});

export function platformForPreset(preset) {
    return Object.hasOwn(PRESET_PLATFORMS, preset) ? PRESET_PLATFORMS[preset] : 'douban';
}
