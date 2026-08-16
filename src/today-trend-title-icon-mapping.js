import {
    CALENDAR_ICON_SVG, COMMUNITY_ICON_SVG, HEART_ICON_SVG, LIVE_ICON_SVG, OUTFIT_ICON_SVG, RECIPE_ICON_SVG,
    SPARKLES_ICON_SVG, TIME_ORIGIN_ICON_SVG, TODAY_TREND_EVENT_DOCUMENT_SVG,
    TODAY_TREND_EVENT_INCIDENT_SVG, TODAY_TREND_EVENT_LOCATION_SVG, TODAY_TREND_EVENT_NORMAL_SVG,
    TODAY_TREND_EVENT_RUMOR_SVG, TODAY_TREND_EVENT_SIGNAL_SVG, TODAY_TREND_EVENT_UNDERGROUND_SVG,
    TODAY_TREND_WORLD_ICON_SVG, TREND_ICON_SVG, WEATHER_CLOUD_ICON_SVG, WEATHER_FOG_ICON_SVG,
    WEATHER_ICON_SVG, WEATHER_PARTLY_CLOUDY_ICON_SVG, WEATHER_SNOW_ICON_SVG, WEATHER_STORM_ICON_SVG,
    WEATHER_SUN_ICON_SVG,
} from './icons.js';
import { TODAY_TREND_TITLE_ICON_TOPICS } from './today-trend-title-icon-topics.js';

const TITLE_ICONS = Object.freeze({
    'weather-storm': WEATHER_STORM_ICON_SVG, 'weather-snow': WEATHER_SNOW_ICON_SVG,
    'weather-fog': WEATHER_FOG_ICON_SVG, 'weather-sun': WEATHER_SUN_ICON_SVG,
    'weather-partly-cloudy': WEATHER_PARTLY_CLOUDY_ICON_SVG, 'weather-cloud': WEATHER_CLOUD_ICON_SVG,
    document: TODAY_TREND_EVENT_DOCUMENT_SVG,
    rumor: TODAY_TREND_EVENT_RUMOR_SVG, signal: TODAY_TREND_EVENT_SIGNAL_SVG,
    calendar: CALENDAR_ICON_SVG, live: LIVE_ICON_SVG, heart: HEART_ICON_SVG,
    location: TODAY_TREND_EVENT_LOCATION_SVG, community: COMMUNITY_ICON_SVG, weather: WEATHER_ICON_SVG,
    trend: TREND_ICON_SVG,
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
    const matchedTopic = TODAY_TREND_TITLE_ICON_TOPICS.find(({ pattern }) => pattern.test(normalizedTitle));
    if (matchedTopic) return iconResult(matchedTopic.key);
    if (kind === 'event') return iconResult(EVENT_FALLBACK_KEYS[String(type || '').toLowerCase()] || 'event-normal');
    return iconResult('world-default');
}
