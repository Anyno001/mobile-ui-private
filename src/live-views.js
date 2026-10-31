import { appNameOf, appSloganOf } from './app-names.js';
import { isLiveRoomWarmedUp } from './interactive-scene-model.js';
import {
    BACK_ICON_SVG, CLOSE_ICON_SVG, EDIT_ICON_SVG, MORE_ICON_SVG, PLAY_ICON_SVG, POKE_ICON_SVG, SEND_ICON_SVG, TRASH_ICON_SVG,
} from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';

export const LIVE_CATEGORIES = Object.freeze(['聊天', '音乐', '游戏', '户外', '读书', '情感', '明星']);
export const LIVE_COVER_COUNT = 5;
export const LIVE_FLY_LIMIT = 8;
// 评论区只留最近几条（照 IGS 的 liveListLimit：观众视角 5 条，主播是我时 6 条）；修改弹幕时显示全部。
export const LIVE_LIST_LIMIT = 5;
export const LIVE_LIST_LIMIT_HOST = 6;
export const liveListLimit = hostIsUser => (hostIsUser ? LIVE_LIST_LIMIT_HOST : LIVE_LIST_LIMIT);

const hashOf = value => {
    let hash = 2166136261;
    for (const character of String(value ?? '')) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

// 在线人数按房间 id 稳定生成：1,200 到 90,000。
export function liveOnlineCount(roomId) {
    return 1200 + (hashOf(`online:${roomId}`) % 88801);
}

export function formatLiveOnline(count) {
    const value = Math.max(0, Math.floor(Number(count) || 0));
    if (value >= 10000) return `${(Math.floor(value / 1000) / 10).toFixed(1)}万 在线`;
    return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} 在线`;
}

// 直播间顶栏的紧凑数字：一万以上写成「2.3万」，不带单位后缀。
export function formatLiveCount(count) {
    const value = Math.max(0, Math.floor(Number(count) || 0));
    if (value >= 10000) return `${(Math.floor(value / 1000) / 10).toFixed(1).replace(/\.0$/, '')}万`;
    return String(value);
}

// 热度：在线人数加上已有弹幕的分量，只用于展示。
export function liveHeat(roomId, danmakuCount) {
    return liveOnlineCount(roomId) * 3 + Math.max(0, Number(danmakuCount) || 0) * 17;
}

// 封面色按房间 id 哈希取 1 到 5 号。
export function liveCoverIndex(roomId) {
    return (hashOf(`cover:${roomId}`) % LIVE_COVER_COUNT) + 1;
}

// 飘屏弹幕的延迟、时长与纵向微偏移，由弹幕自身稳定决定；轨道由 planLiveFlyLanes 按画面高度统一分配，lane 只是兜底值。
export function getLiveDanmakuMotion(item) {
    const hash = hashOf(item?.id || `${item?.authorNameSnapshot || item?.author || ''}:${item?.content || ''}`);
    return {
        lane: hash % 6,
        delay: -((hash >>> 4) % 45) / 10,
        duration: 5 + ((hash >>> 9) % 51) / 10,
        offset: ((hash >>> 15) % 5) - 2,
    };
}

// 照 IGS danmaku-lanes：一条轨道同一时刻只放一条弹幕，轨道数由画面高度决定。
// kinds 按时间从旧到新排列；轨道不够时先丢普通观众弹幕（旧的先丢），再丢主播弹幕；返回每条的轨道号，-1 表示丢弃。
export function planLiveFlyLanes(kinds, laneCount) {
    const cap = Math.max(1, Math.floor(Number(laneCount) || 0));
    const order = Array.from(kinds.keys());
    const dropOrder = order.slice().sort((a, b) => (kinds[a] === 'host') - (kinds[b] === 'host') || a - b);
    const dropped = new Set(dropOrder.slice(0, Math.max(0, kinds.length - cap)));
    const kept = order.filter(index => !dropped.has(index));
    const lanes = kinds.map(() => -1);
    // 保留的条数不超过轨道数时，按比例铺开，相邻两条之间至少隔一条轨道的步长。
    kept.forEach((index, position) => { lanes[index] = kept.length > 1 ? Math.round(position * (cap - 1) / (kept.length - 1)) : 0; });
    return lanes;
}

// 按横飞区实际高度重排轨道：画面显示后调用；还没布局出来（高度为 0）时保持默认轨道。
export function fitLiveFly(page) {
    const fly = page?.querySelector?.('.pm-live-fly');
    if (!fly) return;
    const pitch = Number.parseFloat(globalThis.getComputedStyle?.(fly)?.getPropertyValue('--pm-live-lane-pitch'));
    if (!(fly.clientHeight > 0) || !(pitch > 0)) return;
    const spans = Array.from(fly.children);
    const lanes = planLiveFlyLanes(spans.map(span => (span.classList.contains('is-host') ? 'host' : 'chat')), Math.floor(fly.clientHeight / pitch));
    spans.forEach((span, index) => {
        if (lanes[index] < 0) span.remove();
        else span.style.setProperty('--lane', String(lanes[index]));
    });
}

export function liveInitial(name) {
    return Array.from(String(name || '').trim())[0] || '播';
}

export function describeLiveRoom(scope, room) {
    const hostName = room.hostNameSnapshot || '主播';
    const started = isLiveRoomWarmedUp(scope, room);
    return {
        id: room.id,
        title: room.title,
        hostName,
        hostIsUser: room.hostIsUser === true,
        category: room.category || '',
        initial: liveInitial(hostName),
        cover: liveCoverIndex(room.id),
        started,
        // 从 gal 正文同步来的直播间：ended 表示正文里已下播（房间保留，可以继续拍一拍续写）。
        ended: room.ended === true,
        fromStory: room.source?.type === 'igs',
        online: formatLiveOnline(liveOnlineCount(room.id)),
        viewers: started ? formatLiveCount(liveOnlineCount(room.id)) : '0',
        heat: started ? formatLiveCount(liveHeat(room.id, room.danmaku?.length)) : '0',
    };
}

const statusStrip = status => `<div class="pm-live-status" role="status" aria-live="polite"${status ? '' : ' hidden'}>${escapeHtml(status || '')}</div>`;

// segments：噼哩噼哩首页的「视频 / 直播」分段 HTML，由 live-app 传入；不传时没有分段（单独渲染直播列表）。
export function renderLiveList({ rooms = [], status = '', segments = '' } = {}) {
    const cards = rooms.map(room => `<article class="pm-live-card"><button type="button" class="pm-live-card-open" data-live-action="open-room" data-room-id="${escapeAttr(room.id)}" aria-label="进入直播间：${escapeAttr(room.title)}"><span class="pm-live-cover is-cover-${room.cover}"><span class="pm-live-initial">${escapeHtml(room.initial)}</span><span class="pm-live-pill ${room.started && !room.ended ? 'is-on' : 'is-off'}">${room.ended ? '已下播' : room.started ? '直播中' : '未开播'}</span>${room.started && !room.ended ? `<span class="pm-live-count">${escapeHtml(room.online)}</span>` : ''}</span><span class="pm-live-card-info"><b>${escapeHtml(room.title)}</b><span>${escapeHtml(room.hostName)}${room.category ? ` · ${escapeHtml(room.category)}` : ''}${room.fromStory ? ' · 来自正文' : ''}</span></span></button></article>`).join('');
    const body = cards
        ? `<div class="pm-live-grid">${cards}</div>`
        : '<div class="pm-live-empty"><b>还没有直播间</b><button type="button" class="pm-live-primary" data-live-action="compose">开播</button></div>';
    return `<div id="pm-live-app" class="pm-live-shell" data-live-view="list">
        <div class="pm-live-topbar"><button type="button" class="pm-live-icon-button" data-live-action="desktop" aria-label="返回桌面" title="返回桌面">${BACK_ICON_SVG}</button><b class="pm-live-heading">${escapeHtml(appNameOf('live'))}</b><button type="button" class="pm-live-pill-button" data-live-action="compose">开播</button></div>
        ${segments}
        ${statusStrip(status)}
        <div class="pm-live-scroll"><p class="pm-live-slogan">${escapeHtml(appSloganOf('live'))}</p>${body}</div>
    </div>`;
}

const chip = (action, dataAttr, label, pressed) => `<button type="button" class="pm-live-chip" data-live-action="${action}" ${dataAttr} aria-pressed="${pressed}">${escapeHtml(label)}</button>`;

// 开播页（新建与编辑共用）。form: { title, category, hostKey, hostName, hostSetting, nsfw }，hosts: [{ key, label }]。
export function renderLiveCompose({ form = {}, hosts = [], editing = false, status = '' } = {}) {
    const category = String(form.category || '');
    const customCategory = category && !LIVE_CATEGORIES.includes(category) ? category : '';
    const categoryChips = LIVE_CATEGORIES.map(item => chip('pick-category', `data-category="${escapeAttr(item)}"`, item, item === category)).join('');
    const hostChips = hosts.map(host => chip('pick-host', `data-host="${escapeAttr(host.key)}"`, host.label, host.key === form.hostKey)).join('');
    const otherField = form.hostKey === 'other'
        ? `<input id="pm-live-host-name" class="pm-live-input" maxlength="80" placeholder="主播名字" aria-label="主播名字" value="${escapeAttr(form.hostName || '')}">` : '';
    const nsfw = form.nsfw === true;
    const submitLabel = editing ? '保存' : '开播';
    return `<div id="pm-live-app" class="pm-live-shell" data-live-view="compose">
        <div class="pm-live-topbar"><button type="button" class="pm-live-icon-button" data-live-action="${editing ? 'cancel-edit' : 'list'}" aria-label="返回" title="返回">${BACK_ICON_SVG}</button><b class="pm-live-heading">${editing ? '编辑直播间' : '开播'}</b><span class="pm-live-topbar-gap" aria-hidden="true"></span></div>
        ${statusStrip(status)}
        <div class="pm-live-scroll"><div class="pm-live-form">
            <label class="pm-live-field"><span>标题</span><input id="pm-live-title" class="pm-live-input" maxlength="100" placeholder="给直播间起个名字" value="${escapeAttr(form.title || '')}"></label>
            <div class="pm-live-field" role="group" aria-label="分区"><span>分区</span><div class="pm-live-chips">${categoryChips}</div><input id="pm-live-category-custom" class="pm-live-input" maxlength="12" placeholder="自定义分区" aria-label="自定义分区" value="${escapeAttr(customCategory)}"></div>
            <div class="pm-live-field" role="group" aria-label="主播"><span>主播</span><div class="pm-live-chips">${hostChips}</div>${otherField}</div>
            <label class="pm-live-field"><span>主播设定</span><textarea id="pm-live-host-setting" class="pm-live-input pm-live-textarea" maxlength="1000" placeholder="性格、口头禅、直播风格，可以留空">${escapeHtml(form.hostSetting || '')}</textarea></label>
            <div class="pm-live-switch-row"><span class="pm-live-switch-text"><b>成人内容</b><small>开启后可以写露骨的成人内容</small></span><button type="button" id="pm-live-nsfw" class="pm-live-switch ${nsfw ? 'is-on' : ''}" role="switch" aria-checked="${nsfw}" aria-label="成人内容" data-live-action="toggle-nsfw"></button></div>
            <button type="button" class="pm-live-primary" data-live-action="submit">${submitLabel}</button>
            ${editing ? '<button type="button" class="pm-live-danger" data-live-action="delete-room">删除直播间</button>' : ''}
        </div></div>
    </div>`;
}

// 直播间图标：24 视框，描边随 currentColor，只搬形状，不引用 IGS 代码。
const liveIcon = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const FLAME_ICON = liveIcon('<path d="M12 21.4c3.5 0 5.9-2.3 5.9-5.7 0-2.6-1.5-4.5-2.9-6.1-.4 1.5-1.2 2.5-2.3 2.9.5-2.9-.6-6-3.1-8.3-.2 3.1-1.8 4.9-3.1 6.5-1.2 1.4-2.3 3-2.3 5 0 3.4 2.4 5.7 5.8 5.7z" fill="currentColor" stroke="none"/>');
const VIEWERS_ICON = liveIcon('<circle cx="12" cy="8.3" r="3.3"/><path d="M5.6 19.6c.7-3.4 3.3-5.3 6.4-5.3s5.7 1.9 6.4 5.3"/>');
const PLUS_ICON = liveIcon('<path d="M12 7v10M7 12h10"/>');
const GIFT_ICON = liveIcon('<rect x="3.8" y="8.2" width="16.4" height="4" rx="1.1"/><path d="M5.3 12.2v6.9c0 .9.7 1.6 1.6 1.6h10.2c.9 0 1.6-.7 1.6-1.6v-6.9M12 8.2v12.5"/><path d="M12 8.2C10.9 5.6 7.7 4.9 7.2 6.6c-.4 1.4 2 1.6 4.8 1.6zm0 0c1.1-2.6 4.3-3.3 4.8-1.6.4 1.4-2 1.6-4.8 1.6z"/>');
const HEART_ICON = liveIcon('<path d="M12 20.2s-7.4-4.5-7.4-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.4 2.7c0 5.6-7.4 10.1-7.4 10.1z" fill="currentColor" stroke="none"/>');

const FLY_TEXT_MAX = 14;
// 横飞只飞前 14 个全角字（半角按半个字算），超出加省略号；评论区保留全文。
export function flyClip(value) {
    const chars = Array.from(String(value || ''));
    let units = 0;
    for (let index = 0; index < chars.length; index += 1) {
        units += chars[index].charCodeAt(0) > 0xff ? 1 : 0.55;
        if (units > FLY_TEXT_MAX) return `${chars.slice(0, index).join('')}…`;
    }
    return chars.join('');
}

// 评论条：名字色、主播标签、投喂行三种样式照 IGS；修改弹幕时行尾出现编辑与删除。
function renderMessage(item, editing) {
    const author = escapeHtml(item.author);
    const actions = editing && item.kind !== 'system'
        ? `<span class="pm-live-row-actions"><button type="button" data-live-action="edit-danmaku" data-danmaku-id="${escapeAttr(item.id)}" aria-label="编辑弹幕" title="编辑弹幕">${EDIT_ICON_SVG}</button><button type="button" class="is-danger" data-live-action="delete-danmaku" data-danmaku-id="${escapeAttr(item.id)}" aria-label="删除弹幕" title="删除弹幕">${TRASH_ICON_SVG}</button></span>` : '';
    if (item.kind === 'system') return `<div class="pm-live-msg is-system">${escapeHtml(item.content)}</div>`;
    if (item.kind === 'gift') return `<div class="pm-live-msg is-gift"><span class="pm-live-line"><b class="pm-live-name">${author}</b> 投喂 ${escapeHtml(item.content)} ×1</span>${actions}</div>`;
    if (item.kind === 'host') return `<div class="pm-live-msg is-host"><span class="pm-live-line"><em class="pm-live-tag">主播</em><b class="pm-live-name">${author}：</b><span class="pm-live-text">${escapeHtml(item.content)}</span></span>${actions}</div>`;
    return `<div class="pm-live-msg is-chat"><span class="pm-live-line"><b class="pm-live-name">${author}：</b><span class="pm-live-text">${escapeHtml(item.content)}</span></span>${actions}</div>`;
}

// 直播间页。room 来自 describeLiveRoom；danmaku: [{ id, kind, author, content }]；
// ui: { editing, busy, welcome, status, menuOpen }。
export function renderLiveRoom({ room, danmaku = [], ui = {} }) {
    // 礼物只在评论区显示，不进横飞；轨道先按默认轨道数铺开，画面显示后由 fitLiveFly 按实际高度重排。
    const flyItems = danmaku.filter(item => item.kind !== 'system' && item.kind !== 'gift').slice(-LIVE_FLY_LIMIT);
    const flyLanes = planLiveFlyLanes(flyItems.map(item => item.kind), LIVE_FLY_LIMIT);
    const flying = flyItems.map((item, index) => {
        const motion = getLiveDanmakuMotion(item);
        return `<span class="is-${item.kind === 'host' ? 'host' : 'chat'}" style="--lane:${flyLanes[index]};--delay:${motion.delay}s;--duration:${motion.duration}s;--offset:${motion.offset}px">${escapeHtml(flyClip(item.content))}</span>`;
    }).join('');
    const rows = [
        ...(ui.welcome && !room.hostIsUser ? [{ kind: 'system', content: `欢迎 ${ui.welcome} 进入直播间` }] : []),
        ...danmaku,
    ];
    const messages = (ui.editing === true ? rows : rows.slice(-liveListLimit(room.hostIsUser)))
        .map(item => renderMessage(item, ui.editing === true)).join('')
        || '<div class="pm-live-msg is-system">还没有人发言，拍一拍请求第一批弹幕。</div>';
    const stageState = room.started ? 'active' : ui.busy ? 'starting' : 'idle';
    const play = !room.started && !ui.busy
        ? `<button type="button" class="pm-live-play" data-live-action="warmup" aria-label="开始热场" title="开始热场">${PLAY_ICON_SVG}</button>` : '';
    const note = ui.busy ? `<p class="pm-live-note">${room.started ? '正在生成弹幕…' : '正在准备热场…'}</p>` : '';
    const placeholder = room.hostIsUser ? '对观众说……' : '发个弹幕';
    const follow = room.hostIsUser ? '' : `<span class="pm-live-follow">${PLUS_ICON}<span>关注</span></span>`;
    return `<div id="pm-live-app" class="pm-live-shell" data-live-view="room" data-room-id="${escapeAttr(room.id)}">
        <section class="pm-live-stage" data-live-state="${stageState}" aria-label="直播画面" aria-busy="${ui.busy === true}">
            <div class="pm-live-top">
                <div class="pm-live-host"><span class="pm-live-host-avatar" aria-hidden="true">${escapeHtml(room.initial)}</span><span class="pm-live-meta"><span class="pm-live-host-name">${escapeHtml(room.hostName)}</span><span class="pm-live-pop">${FLAME_ICON}<span>${escapeHtml(room.heat)}</span></span></span>${follow}</div>
                <div class="pm-live-tools"><span class="pm-live-viewers">${VIEWERS_ICON}<span>${escapeHtml(room.viewers)}</span></span><button type="button" class="pm-live-glass" data-live-action="list" aria-label="返回直播列表" title="返回直播列表">${CLOSE_ICON_SVG}</button></div>
            </div>
            <div class="pm-live-fly" aria-hidden="true">${flying}</div>
            <p class="pm-live-ttl">${room.ended ? '已下播' : room.started ? '正在直播' : '未开播'}：${escapeHtml(room.title)}</p>
            <div class="pm-live-center"><span class="pm-live-room-initial" aria-hidden="true">${escapeHtml(room.initial)}</span>${play}${note}</div>
        </section>
        ${statusStrip(ui.status)}
        <div class="pm-live-chat${ui.editing === true ? ' is-editing' : ''}" role="log" aria-label="评论区">${messages}</div>
        <div class="pm-live-rail">
            <div class="pm-live-menu-wrap"><button type="button" class="pm-live-glass" data-live-action="menu" aria-label="直播间菜单" title="直播间菜单" aria-haspopup="menu" aria-expanded="false">${MORE_ICON_SVG}</button>
            <div class="pm-live-menu" role="menu" aria-label="直播间菜单" hidden>
                <button type="button" role="menuitem" data-live-action="edit-room">编辑直播间</button>
                <button type="button" role="menuitem" data-live-action="toggle-edit-danmaku" aria-pressed="${ui.editing === true}">${ui.editing ? '停止修改' : '修改弹幕'}</button>
                <button type="button" role="menuitem" class="is-danger" data-live-action="delete-room">删除直播间</button>
            </div></div>
            <button type="button" class="pm-live-glass" data-live-action="poke" aria-label="拍一拍，请求下一批弹幕" title="拍一拍，请求下一批弹幕"${ui.busy ? ' disabled' : ''}>${POKE_ICON_SVG}</button>
        </div>
        <div class="pm-live-bar">
            <div class="pm-live-capsule"><input id="pm-live-input" class="pm-live-input" maxlength="200" placeholder="${placeholder}" aria-label="${placeholder}"><button type="button" class="pm-live-send" data-live-action="send" aria-label="发送" title="发送">${SEND_ICON_SVG}</button></div>
            <span class="pm-live-deco is-gift" aria-hidden="true">${GIFT_ICON}</span><span class="pm-live-deco is-like" aria-hidden="true">${HEART_ICON}</span>
        </div>
    </div>`;
}
