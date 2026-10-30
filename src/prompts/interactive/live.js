import { dataBlock } from './shared.js';

const LIVE_KIND_HOST = 'host（主播口播，2-4 条，会回应前面的弹幕）、';
const LIVE_KIND_AUDIENCE = 'chat（观众弹幕，8-14 条）、gift（礼物，0-2 条，content 写礼物名，如「一束花」）。';
export const LIVE_DANMAKU_FIELDS = `items 字段为 author、content（不超过 60 字）、kind。kind 取值：${LIVE_KIND_HOST}${LIVE_KIND_AUDIENCE}`;
const LIVE_AUDIENCE_FIELDS = `items 字段为 author、content（不超过 60 字）、kind。kind 取值：${LIVE_KIND_AUDIENCE}`;

const lineOf = item => {
    const author = String(item?.author ?? item?.authorNameSnapshot ?? '').trim().slice(0, 40) || '观众';
    const content = String(item?.content ?? '').trim().slice(0, 120);
    const kind = ['chat', 'host', 'gift', 'system'].includes(item?.kind) ? item.kind : 'chat';
    return content ? `[${kind}] ${author}：${content}` : '';
};

// 直播间与社区无关：弹幕语气由分区和房间标题决定。
export function buildLiveTask({ room, recentDanmaku, hostIsUser }) {
    const title = String(room?.title || '').trim();
    const category = String(room?.category || '').trim();
    const hostName = String(room?.hostName ?? room?.hostNameSnapshot ?? '').trim();
    const hostSetting = String(room?.hostSetting || '').trim();
    const recent = (Array.isArray(recentDanmaku) ? recentDanmaku : []).slice(-20).map(lineOf).filter(Boolean).join('\n');
    const blocks = [
        dataBlock('live_room_data', `标题：${title || '未命名直播间'}\n分区：${category || '未分区'}`, 400),
        dataBlock('live_host_data', `主播：${hostName || '主播'}${hostSetting ? `\n设定：${hostSetting}` : ''}`, 2000),
        dataBlock('recent_danmaku_data', recent, 4000),
    ].join('\n');
    const hostRule = hostIsUser
        ? '主播是用户本人：不要生成 host，items 里只写 chat 和 gift；观众要回应 recent_danmaku_data 中用户最近的口播。'
        : '主播由你扮演：host 口播要回应前面的弹幕，保持主播的人设。';
    const task = `为这间直播生成新的一批弹幕。${hostIsUser ? LIVE_AUDIENCE_FIELDS : LIVE_DANMAKU_FIELDS}\n弹幕语气由分区和房间标题决定，有即时反应、互相呼应，语气各不相同。${hostRule}\n不生成帖子、标题、标签或评论数组。`;
    return { blocks, task };
}
