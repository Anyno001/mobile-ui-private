// Origin 系统核心 · 注入文本。
// 来源：vicliaaa/origin-sillytavern v1.5 的 buildInjection / onPromptReady（作者已授权移植）。提示词原文逐字照搬，作者调过服从率。
// 与原插件的唯一差别：到期判定与成就检查已在回放里做完，这里只读；pendingUse / pendingEvent 由账本按「本轮输入」算出后传入。
import { allowNewTask, tRemain } from './origin-apply.js';
import { personaOf } from './origin-state.js';

// view：{ st(回放状态), world, direction, pendingUse[], pendingEvent[] }；turn：提示词生成时已有的 AI 楼数。
export function buildInjection(view, s, turn) {
    const st = view && view.st;
    if (!st) return '';
    if (st.paused) return '';
    const world = view.world || '';
    const direction = view.direction || '';
    const pendingUse = view.pendingUse || [];
    const pendingEvent = view.pendingEvent || [];
    const active = st.tasks.filter((t) => t.status === 'active');
    let out = '【Origin 状态】' + (s.sysName && s.sysName !== 'Origin' ? '（系统名：' + s.sysName + '）' : '') + '\n';
    const _host = (s.bindTo && s.bindTo !== '宿主') ? s.bindTo : '';
    const _autoEcon = s.autoEcon || !!_host;
    if (_host) out += '★本系统绑定的是角色【' + _host + '】，不是宿主(user)。任务/积分/属性/成就都属于 ' + _host + '；请让 ' + _host + ' 像突然获得金手指系统的主角那样思考、并主动完成系统任务。宿主(user)是旁观者或其他在场角色，系统不向 user 派任务、也不对 user 说话（除非 user 正在扮演 ' + _host + '）。\n';
    out += '世界：' + (world || '未设定') + '\n';
    out += '积分：' + st.points + ' ｜ 等级 Lv.' + st.level + '\n';
    if (st.stats.length) out += '属性：' + st.stats.map((x) => x.name + x.val).join(' ') + '\n';
    if (st.perks && st.perks.length) out += (_host || '宿主') + '已开启的权限/特权（永久有效）：' + st.perks.map((k) => k.name + (k.desc ? '（' + k.desc + '）' : '')).join('；') + '\n';
    if (st.skills && st.skills.length) out += (_host || '宿主') + '已掌握的技能（永久持有，写剧情时要体现它们在起作用）：' + st.skills.map((k) => k.name + (k.desc ? '（' + k.desc + '）' : '')).join('；') + '\n';
    const fmtT = (t) => { const rem = tRemain(t, turn); return '  [' + t.type + '#' + t.id + '] ' + t.title + '（进度' + (t.progress || 0) + '%' + (rem !== null ? ('，剩' + Math.max(0, rem) + '回合') : '') + '）｜要求:' + (t.cond || '—') + (t.reward ? '｜奖:' + t.reward : '') + (t.penalty ? '｜罚:' + t.penalty : '') + '\n'; };
    const _primary = _host || '宿主';
    const _mine = active.filter((t) => (t.owner || '宿主') === _primary);
    const _theirs = active.filter((t) => (t.owner || '宿主') !== _primary);
    out += (_host ? ('【' + _host + '】') : '宿主(user)') + '的进行中任务：\n';
    if (_mine.length) { for (const t of _mine) out += fmtT(t); } else out += '  （暂无）\n';
    if (_theirs.length) { out += '系统给角色布置的任务（请让对应角色在剧情里自己朝这些目标行动、推进，不需要宿主指挥）：\n'; for (const t of _theirs) out += '  【给' + t.owner + '】' + fmtT(t).replace(/^\s+/, ''); }
    if (s.mods.bag && st.bag && st.bag.length) out += (_host || '宿主') + '背包：' + st.bag.map((b) => b.name + '×' + (b.count || 1)).join('，') + '\n';
    if (_autoEcon && s.mods.shop && st.shop && st.shop.length) out += '商城（可花积分买，当前积分' + st.points + '）：' + st.shop.slice(0, 8).map((x) => x.name + '(' + x.price + ')').join(' ／ ') + '\n';
    if (pendingUse.length) out += '【本回合宿主动作】' + pendingUse.map((u) => '使用了道具「' + u.name + '」' + (u.desc ? '（' + u.desc + '）' : '')).join('；') + '——请让剧情与角色对此作出合理反应。\n';
    if (pendingEvent.length) out += '【本回合系统事件】' + pendingEvent.join('；') + '——请把它自然写进正文（系统播报口吻，或让剧情直接呈现）。\n';
    if (s.mods.shop && s.shopRefresh > 0 && (turn - (st.lastShopTurn || -99)) >= s.shopRefresh) out += '【商城可更新】本回合请在数据块用『新商品|名称|价格|说明|效果』提供 2-3 个贴合当前世界观与宿主玩法方向的新商品（可替换旧的）。\n';
    if (s.mods.gacha && s.gachaRefresh > 0 && (turn - (st.lastGachaTurn || -99)) >= s.gachaRefresh) out += '【奖池可更新】本回合请在数据块用『新奖品|名称|稀有度|权重|说明|效果』给出 3-5 个贴合当前世界观与宿主玩法方向的奖品，整套替换奖池。\n';

    out += '\n【本回合规则】\n';
    out += '0. 【填表前逐条核对·不可省略】写完正文后，先把上面列出的每一个进行中任务过一遍：这回合正文里有没有与它相关的事？然后在数据块里为【每一个】进行中任务各写一行『进度|id|百分比|依据』——有进展就更新百分比并写依据；没进展也要写，百分比照旧、依据写『本回合无进展』。一个任务都不能漏，本回合正文里出现的积分变动、获得物品、系统发布的新任务也都必须落到对应的行里。<origin> 数据块每回合必须存在（就叫 origin，别起别的名）。\n';
    out += '1. 依据本回合正文里实际发生的事，更新上面任务的进度或判定完成/失败；据实判定，没发生的进展不要写，禁止替宿主(user)自动完成任务。当某个进行中任务的完成条件在本回合剧情里达成了，必须输出一行『完成|任务id』（用上面列出的数字id），不要漏、不要只在嘴上说完成了。任务可以在被发布的同一回合就完成——只要本回合剧情已达成条件，就立刻报完成、进度直接给到100，禁止为了拉长节奏而故意压低进度或把已完成的任务拖到以后。\n';
    if (_host) out += '（系统绑定于 ' + _host + '：请让 ' + _host + ' 主动推进并完成自己的系统任务，这是主角在用金手指，不算替宿主完成。）\n';
    const allow = allowNewTask(st, s, turn);
    if (s.taskSource === 'manual') {
        out += '2. 本回合不要自动发任务（宿主设为只手写）。\n';
    } else if (allow) {
        if (active.length === 0) {
            out += '2. 当前没有任何任务：请在本回合、或最迟下一回合，发起 1 个能把宿主带入这个世界目标的开场任务（优先主线），不要一直不发。';
        } else {
            out += '2. 允许发新任务：若当前剧情合适，可发起 1 个贴合此刻情节的新任务（主线/支线/日常）；若不适合也可以不发。';
        }
        if (direction) out += '宿主希望的任务方向：' + direction + '（尽量贴合，同时贴合当前剧情）。';
        out += '\n';
    } else {
        out += '2. 本回合不要发新任务（未到频率或尚有主线/支线未完成）。\n';
    }
    if (s.fourthWall > 0) out += '3. 第四面墙：有约 ' + s.fourthWall + '% 的概率，系统可短暂打破第四面墙做一句元叙事吐槽，其余时候照常演，不要每次都破。\n';
    else out += '3. 不要打破第四面墙。\n';
    out += '4. 系统说话风格：' + personaOf(s) + '\n';
    if (_autoEcon) out += '· ' + (_host || '宿主') + '手里有系统就要用起来：积分充裕时，主动在合适时机花积分买道具（尤其能助攻当前任务的）、抽奖、或用背包里的道具，别一直攒着不花——金手指就是拿来用的。大约每 3-5 回合至少体现一次他在动用系统（买／抽／用其一），但要有动机、结合剧情，别每回合乱刷。积分不够就不买。要做时在数据块报告：买|商品名 ／ 抽奖 ／ 用道具|名称。\n';
    out += '5. 若' + (_host || '宿主(user)') + '在正文里直接对系统说话或提问（如『系统，…』），系统要用上面的说话风格回应；可以解释任务、给提示、调侃、回应请求或商量；但不得替其做决定，任何积分/属性/任务的实际变动仍必须走下面的数据块。\n';
    out += '6. 奖励是对宿主有利的（加积分/加属性/加好感/给道具/给技能/开权限等，技能奖励写成 技能：名称、权限写成 权限：名称）；失败惩罚才是不利的。禁止把不利内容写进奖励栏。\n';
    out += '7. 失败惩罚可以是扣积分、掉属性、失去道具、触发不利事件、或限时未达成的后果等，按剧情自由选，不必总是扣好感，也允许有的任务没有惩罚。\n';
    if (s.rewardPref) out += '8. 奖励偏好：' + s.rewardPref + '。\n';
    if (s.penaltyPref) out += '9. 惩罚偏好：' + s.penaltyPref + '。\n';

    if (s.limitMax > 0) out += '给任务设时限时，请在 ' + s.limitMin + '-' + s.limitMax + ' 回合之间按任务轻重浮动取值，不要每次都用同一个数；不紧急的任务也可以不设时限（时限留空）。\n';
    out += '\n【输出】在回复最末尾另起一行，输出 ' + s.sysName + ' 数据块（此块不属于正文、不计字数、不影响文风）：\n';
    out += '<origin>\n';
    out += '进度|任务id|新百分比0-100|一句依据（正文里发生了什么）\n';
    out += '完成|任务id\n';
    out += '失败|任务id\n';
    out += '新任务|类型:主线或支线或日常|标题:…|描述:…|条件:…|奖励:积分300 魅力+2|惩罚:…（可空）|时限:' + (s.limitMax > 0 ? ('取 ' + s.limitMin + '到' + s.limitMax + ' 之间的整数，别用更小的') : '一个整数或留空') + '|对象:宿主或角色名（默认宿主，若这是系统给某角色布置的任务就写角色名）\n';
    out += '（新任务每个字段务必用「标签:值」写清楚，例如 奖励:积分300；缺的字段整段不写即可。）\n';
    out += '（★关键：正文里系统「发布/派发/给出」一个新任务时，必须用上面的『新任务|...』这一行来创建它，绝对不能用『进度|』代替。『进度|』只用于更新上面【已经列出】的现有任务。任务id只能用上面列出的数字，禁止自己编造 id、也别写「隐藏ID」。）\n';
    out += '积分|+N或-N|理由　（正文里凡是发放或扣除积分，必须同步写这一行，不要只在正文里写「积分：N」；面板积分以数据块为准，正文的余额要与面板一致）\n';
    out += '属性|名称|+N或-N\n';
    out += '技能|名称|一句说明　（剧情里真正获得或解锁一项技能/能力/被动时用；技能永久持有、不是物品，别写成获得|）\n';
    out += '权限|名称|一句说明　（开启某项权限/特权/功能/称号时用，永久持有）\n';
    out += '播报|一句系统口吻的话（用上面的说话风格）\n';
    if (_host && s.mods.chat !== false && s.rpChat !== 'manual') out += '私聊|系统 或 ' + _host + '|一句话　（这回合 ' + _host + ' 和系统私下说的话，只有他听得见、不进正文；2-4行、一行一句、两边交替；这回合没说就不写）\n';
    if (s.mods.bag) { out += '获得|名称|数量　（在剧情里得到某个物品时）\n'; out += '用道具|名称　（在剧情里用掉或消耗了背包里的某个物品时，我会从背包扣掉）\n'; }
    if (_autoEcon) { out += '买|商品名　（角色花积分从商城购买，自动进背包）\n'; if (s.mods.gacha) out += '抽奖　（角色花积分抽一次，结果自动进背包）\n'; }
    if (s.mods.ach) out += '成就|名称|一句描述（仅当剧情里真正达成了值得纪念的高光时才发，罕见，别滥发）\n';
    out += '新商品|名称|价格(整数)|说明|数值效果(可空)　（仅在收到『商城可更新』指令时才用）\n';
    if (s.mods.gacha) out += '新奖品|名称|稀有度(N/R/SR/SSR/UR)|权重(整数)|说明|数值效果(可空)　（仅在收到『奖池可更新』指令时才用，一次给全套3-5个）\n';
    out += '</origin>\n';
    out += '（标签必须原样写 <origin> 与 </origin>，不许改成「数据板」「数据块」或别的名字；块里不要加「系统：……」之类的小标题、不要加项目符号，每一行只能是上面列出的某一种格式，第一个字段必须是 进度／完成／新任务 这类标签名。）\n';
    out += '规则：任务id用上面列出的数字；没有对应内容就不写该行；完全无变化则输出 <origin>无</origin>。新任务的各字段请用「标签:值」写（如 奖励:积分300、时限:8）；描述与条件里不得出现竖线 |。\n';

    if (out.length > s.budget) { const cut = out.lastIndexOf('\n', s.budget); out = out.slice(0, cut > 0 ? cut : s.budget); }
    return out;
}

// 原插件 onPromptReady：永远放在提示词的最后一条（垫尾之后），模型对末尾指令的服从率最高。
export function injectInto(chat, text) {
    if (!Array.isArray(chat) || !text) return false;
    chat.push({ role: 'system', content: text });
    return true;
}
