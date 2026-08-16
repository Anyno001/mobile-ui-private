import {
    CALENDAR_ICON_SVG, HEART_ICON_SVG, LIVE_ICON_SVG, OUTFIT_ICON_SVG, RECIPE_ICON_SVG,
    SPARKLES_ICON_SVG, TIME_ORIGIN_ICON_SVG, TODAY_TREND_EVENT_DOCUMENT_SVG,
    TODAY_TREND_EVENT_INCIDENT_SVG, TODAY_TREND_EVENT_LOCATION_SVG, TODAY_TREND_EVENT_NORMAL_SVG,
    TODAY_TREND_EVENT_RUMOR_SVG, TODAY_TREND_EVENT_SIGNAL_SVG, TODAY_TREND_EVENT_UNDERGROUND_SVG,
    TODAY_TREND_WORLD_ICON_SVG, TREND_ICON_SVG, WEATHER_ICON_SVG, WEATHER_STORM_ICON_SVG,
} from './icons.js';

const TITLE_ICON_RULES = Object.freeze([
    ['weather-storm', /雷暴|暴雨|台风|飓风|洪水|山火|地震|灾害/],
    ['document', /公告|通告|签署|协议|条约|法令|政策|通知|报告/],
    ['rumor', /传闻|流言|谣言|爆料|辟谣/],
    ['signal', /联络|通讯|信号|对接|协作|会谈/],
    ['calendar', /日程|期限|会议|峰会|纪念|周年|倒计时/],
    ['live', /直播|演出|开幕|发布会|展演|活动/],
    ['heart', /恋情|恋爱|婚礼|分手|和解|告白/],
    ['location', /航线|路线|港口|机场|车站|城市|城区|区域|地点|迁移/],
    ['weather', /天气|降温|高温|酷暑|寒潮|降雪|雾|云/],
    ['trend', /增长|下滑|复苏|转型|扩张|收缩|走势|趋势/],
    ['sparkles', /发现|突破|研发|实验|新品|异象/],
    ['recipe', /餐饮|美食|食谱|餐厅|菜单/],
    ['outfit', /时装|服饰|穿搭|造型|秀场/],
    ['time', /历史|旧案|溯源|年代|回顾/],
]);

const TITLE_ICONS = Object.freeze({
    'weather-storm': WEATHER_STORM_ICON_SVG, document: TODAY_TREND_EVENT_DOCUMENT_SVG,
    rumor: TODAY_TREND_EVENT_RUMOR_SVG, signal: TODAY_TREND_EVENT_SIGNAL_SVG,
    calendar: CALENDAR_ICON_SVG, live: LIVE_ICON_SVG, heart: HEART_ICON_SVG,
    location: TODAY_TREND_EVENT_LOCATION_SVG, weather: WEATHER_ICON_SVG, trend: TREND_ICON_SVG,
    sparkles: SPARKLES_ICON_SVG, recipe: RECIPE_ICON_SVG, outfit: OUTFIT_ICON_SVG,
    time: TIME_ORIGIN_ICON_SVG, 'world-default': TODAY_TREND_WORLD_ICON_SVG,
    'event-incident': TODAY_TREND_EVENT_INCIDENT_SVG, 'event-underground': TODAY_TREND_EVENT_UNDERGROUND_SVG,
    'event-normal': TODAY_TREND_EVENT_NORMAL_SVG,
});
const EVENT_FALLBACK_KEYS = Object.freeze({ incident: 'event-incident', rumor: 'rumor', underground: 'event-underground' });
const normalizeTitle = title => String(title || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const iconResult = key => ({ key, svg: TITLE_ICONS[key] });

export function resolveTodayTrendTitleIcon({ title = '', kind = 'world', type = 'normal' } = {}) {
    const normalizedTitle = normalizeTitle(title);
    const matchedRule = TITLE_ICON_RULES.find(([, pattern]) => pattern.test(normalizedTitle));
    if (matchedRule) return iconResult(matchedRule[0]);
    if (kind === 'event') return iconResult(EVENT_FALLBACK_KEYS[String(type || '').toLowerCase()] || 'event-normal');
    return iconResult('world-default');
}
