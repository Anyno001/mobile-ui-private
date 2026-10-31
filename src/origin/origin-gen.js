// Origin 系统核心 · 宿主生成请求用的提示词（派任务、商城、奖池、系统对话、私聊）。
// 来源：vicliaaa/origin-sillytavern v1.5 的 genTask / genShop / genGacha / sysChat / genRpChat（作者已授权移植），提示词原文照搬。
// 核心只拼提示词，真正的请求由宿主 generate(kind, prompt) 发出。原料（角色描述、最近剧情）由引擎从酒馆上下文取好后传入。
import { tRemain } from './origin-apply.js';
import { hostOf, personaOf } from './origin-state.js';

export function stripHtml(t) {
    return String(t || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// m：{ st, world, direction, s, cd(角色描述), recent(最近剧情文本) }
export function taskPrompt(m) {
    const { world, direction, s, cd, recent } = m;
    const dir = direction ? ('任务方向：' + direction + '。') : '贴合当前剧情。';
    const limHint = s.limitMax > 0 ? ('若设时限，请在 ' + s.limitMin + '-' + s.limitMax + ' 回合内浮动取值，不紧急可不设。') : '';
    const rewardPref = s.rewardPref ? ('奖励偏好：' + s.rewardPref + '。') : '';
    const penPref = s.penaltyPref ? ('惩罚偏好：' + s.penaltyPref + '。') : '';
    const parts = [];
    if (world) parts.push('【世界】' + world);
    if (cd) parts.push('【角色设定】' + cd);
    parts.push('【最近剧情】\n' + (recent || '（暂无，请出一个开场任务）'));
    return '【系统任务生成】你是这个世界的系统，要贴着上面的世界观与角色，为宿主(user)生成 1 个新任务，' + dir + rewardPref + limHint + '\n'
        + '奖励必须是对宿主有利的（加积分/加属性/加好感/给道具）；失败惩罚是不利的，可以是扣积分/掉属性/失去道具/触发不利事件，按剧情选，不必总扣好感，也可留空。' + penPref + '\n'
        + '只输出一行，严格用这个格式，不要任何多余文字、不要解释、不要思维链：\n新任务|类型:主线或支线或日常|标题:…|描述:…|条件:…|奖励:…|惩罚:…|时限:数字\n每个字段用「标签:值」写清楚，缺的整段不写。\n\n' + parts.join('\n');
}

export function shopPrompt(m) {
    const dir = m.direction ? ('宿主玩法方向：' + m.direction + '。') : '';
    return '【商城生成】为一个穿越系统的积分商城，生成 5 件贴合下面世界观与宿主玩法方向的商品（其中含 1 件作弊/特权类）。' + dir + '\n每件一行，严格格式，不要多余文字、不要解释：\n商品|名称|价格(整数积分)|说明|数值效果(可空,例 魅力+10)\n\n【世界】' + (m.world || '未定') + '\n【角色】' + (m.cd || '');
}

export function gachaPrompt(m) {
    const dir = m.direction ? ('宿主玩法方向：' + m.direction + '。') : '';
    return '【抽奖奖池生成】为一个穿越系统的抽奖，生成 5 件贴合下面世界观与宿主玩法方向的奖品，从常见到稀有都要有。' + dir + '\n每件一行，严格格式，不要多余文字、不要解释：\n奖品|名称|稀有度(N/R/SR/SSR/UR)|权重(整数,越大越常出,如N=50 UR=1)|说明|数值效果(可空,例 积分+200 或 好感+30)\n\n【世界】' + (m.world || '未定') + '\n【角色】' + (m.cd || '');
}

// 系统对话：返回 { system, msgs }；msgs 为最近 12 条 me/sys。flatChat 拼成宿主 generate 用的单个字符串（原插件走酒馆时的拼法）。
export function sysChatPrompt(m) {
    const { st, world, s, recent, turn } = m;
    const active = st.tasks.filter((t) => t.status === 'active');
    let sys = '你是「' + s.sysName + '」，附在宿主身上的系统。现在宿主在系统频道里直接和你说话（不在故事正文里，其他角色听不见）。说话风格：' + personaOf(s) + '\n';
    sys += '世界：' + (world || '未设定') + '。宿主积分 ' + st.points + '，Lv.' + st.level + (st.stats.length ? '，属性：' + st.stats.map((x) => x.name + x.val).join(' ') : '') + '。\n';
    sys += '进行中任务：' + (active.length ? active.map((t) => '#' + t.id + ' ' + t.title + '（' + (t.progress || 0) + '%' + (tRemain(t, turn) != null ? '，剩' + Math.max(0, tRemain(t, turn)) + '回合' : '') + '；要求:' + (t.cond || '—') + '）').join('；') : '无') + '。\n';
    if (st.bag.length) sys += '背包：' + st.bag.map((b) => b.name + '×' + (b.count || 1)).join('，') + '。\n';
    if (st.perks && st.perks.length) sys += '已开启权限：' + st.perks.map((k) => k.name).join('；') + '。\n';
    if (st.skills && st.skills.length) sys += '已掌握技能：' + st.skills.map((k) => k.name + (k.desc ? '（' + k.desc + '）' : '')).join('；') + '。\n';
    if (s.mods.shop && st.shop.length) sys += '商城：' + st.shop.slice(0, 8).map((x) => x.name + '(' + x.price + ')').join('／') + '。\n';
    if (recent) sys += '最近剧情节选：\n' + recent + '\n';
    sys += '要求：只以系统身份回应，1-3 句、不超过 120 字，不写旁白不写动作，用上面的风格。可以答应、拒绝、讨价还价，但要有系统的原则。\n如果你决定改动（改任务进度或时限、发新任务、加减积分、给道具），在回复末尾另起一行附数据块，格式：\n<origin>\n进度|任务id|百分比|依据\n完成|任务id\n时限|任务id|新的剩余回合数\n新任务|类型:主线或支线或日常|标题:…|描述:…|条件:…|奖励:…|惩罚:…|时限:N\n积分|+N或-N|理由\n获得|物品名|数量\n</origin>\n不改动就不要附数据块。';
    const msgs = st.chat.filter((c) => c.who === 'me' || c.who === 'sys').slice(-12).map((c) => ({ role: c.who === 'me' ? 'user' : 'assistant', content: c.text }));
    return { system: sys, msgs };
}
export function flatChat(system, msgs) {
    return system + '\n\n【对话】\n' + msgs.map((x) => (x.role === 'user' ? '宿主：' : '系统：') + x.content).join('\n') + '\n系统：';
}

// 反串私聊（角色与系统）：未绑定角色时返回空串。
export function rpChatPrompt(m) {
    const { st, world, s, cd, recent } = m;
    const host = hostOf(s);
    if (!host) return '';
    const active = st.tasks.filter((t) => t.status === 'active');
    const prev = (st.chat || []).filter((c) => c.who !== 'me').slice(-8).map((c) => ((c.who === 'sys' || c.who === 'call') ? '系统' : host) + '：' + c.text).join('\n');
    const sys = '写一段「' + host + '」和附身在他身上的系统「' + s.sysName + '」的私下对话，只有他听得见系统，不进正文。系统说话风格：' + personaOf(s) + '。' + host + ' 说话要贴他的人设。\n【角色】' + (cd || '') + '\n【世界】' + (world || '未设定') + '\n【他的任务】' + (active.length ? active.map((t) => t.title + '（' + (t.progress || 0) + '%）').join('；') : '无') + '\n【最近剧情】\n' + (recent || '（刚开始）') + (prev ? '\n【之前的私聊】\n' + prev : '') + '\n只输出 3-6 行，每行严格用：私聊|系统 或 ' + host + '|一句话。两边交替，不解释、不加别的。';
    return flatChat(sys, [{ role: 'user', content: '开始' }]);
}
