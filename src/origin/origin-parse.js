// Origin 系统核心 · 提块与逐行解析。
// 来源：vicliaaa/origin-sillytavern v1.5 的 extractBlock / applyBlock（作者已授权移植）；别名、容错、字段标签写法全部保留。
// 解析与状态无关：只把数据块变成操作列表，任务 id 或标题的匹配留到结算时（origin-apply）。
const BLK_TAG = '(?:origin[^>]*|数据[板块]|系统数据[板块]?|origin\\s*数据[板块])';

export function cleanNum(x) {
    const n = parseInt(String(x).replace(/[^0-9-]/g, ''), 10);
    return Number.isNaN(n) ? 0 : n;
}

// 只认最后一个 <origin> 开头的块；思维链里提到的标签不算。开头既认 <origin> 这类标签，也认 ```origin 代码围栏。
export function extractBlock(text) {
    text = String(text || '');
    if (!text) return null;
    const masked = text.replace(/<(thinking|think|thought)>[\s\S]*?<\/\1>/gi, (x) => ' '.repeat(x.length));
    const openRe = new RegExp('<' + BLK_TAG + '>|```\\s*(?:origin|数据[板块]|系统数据)[^\\n]*\\n', 'gi');
    let last = null;
    let mm;
    while ((mm = openRe.exec(masked)) !== null) last = mm;
    if (!last) return null;
    const isFence = last[0].startsWith('```');
    const bodyStart = last.index + last[0].length;
    const after = masked.slice(bodyStart);
    const cm = after.match(isFence ? /```\s*/ : new RegExp('<\\/' + BLK_TAG + '>\\s*', 'i'));
    const bodyLen = cm ? cm.index : after.length;
    const end = cm ? (bodyStart + cm.index + cm[0].length) : text.length;
    if (!cm) {
        const tail = text.slice(bodyStart).replace(/\s/g, '');
        if (tail.length > 1500) return null; // 没闭合又拖着一大段，不像块，别剪
    }
    return { memo: text.slice(bodyStart, bodyStart + bodyLen), start: last.index, end };
}

// 取块并把块从正文剪掉（原插件 harvest 的做法）。没有块时 block 为 null、text 原样返回。
export function splitBlock(text) {
    const ex = extractBlock(text);
    if (!ex) return { block: null, text: String(text || '') };
    const src = String(text || '');
    return { block: ex.memo.trim(), text: (src.slice(0, ex.start) + src.slice(ex.end)).trimEnd() };
}

const TAGS_KNOWN = /^(进度|完成|失败|新任务|积分|属性|播报|获得|用道具|消耗|买|购买|抽奖|成就|新商品|新奖品|私聊|时限)/;
const TASK_TYPES = ['主线', '支线', '日常'];

// 把一行 p（已按 | 切开）规整成原插件认得的形态；与原 applyBlock 前五个预处理一一对应。
function normalizeParts(line, p) {
    if (/^\[?(?:主线|支线|日常)?\s*#?\s*\d+\]?$/.test(p[0]) && /^(完成|失败)$/.test(p[1] || '')) {
        p = [p[1], p[0].replace(/[^0-9]/g, '')];
    }
    if (/^(发布|派发|新任务发布|任务发布|新发布)$/.test(p[0]) && p[1] && !/^(类型|标题|描述|条件|奖励|惩罚|时限|对象)\s*[：:]/.test(p[1])) {
        const tt = p[1];
        const rest = p.slice(2).filter((x) => x && x !== '-' && x !== '—');
        const ty = (rest.find((x) => /^(主线|支线|日常)$/.test(x)) || '支线');
        const ds = rest.filter((x) => !/^(主线|支线|日常)$/.test(x)).join(' ');
        p = ['新任务', '类型:' + ty, '标题:' + tt.replace(/^(新任务|任务)\s*[：:]\s*/, ''), '描述:' + ds, '条件:' + ds];
    }
    if (/^(获取|奖励|结算|发放)$/.test(p[0])) {
        const mm = (p.slice(1).join('|')).match(/积分\s*([+-]?\d+)/);
        if (mm) {
            p = ['积分', mm[1], p.slice(2).join('｜')];
        } else {
            const im = (p[1] || '').match(/^(.+?)\s*[×xX]\s*(\d+)$/);
            p = im ? ['获得', im[1], im[2]] : ['获得', p[1] || '', p[2] || '1'];
        }
    }
    return p;
}

function parseNewTask(p, line) {
    const fields = {};
    let hasLabel = false;
    for (let i = 1; i < p.length; i += 1) {
        const mm = String(p[i] || '').match(/^\s*(类型|标题|名称|描述|说明|完成条件|条件|奖励|失败惩罚|惩罚|时限|对象|归属|奖|罚)\s*[：:]\s*([\s\S]*)$/);
        if (mm) { fields[mm[1]] = mm[2].trim(); hasLabel = true; }
    }
    const g = (...ks) => { for (const k of ks) { if (fields[k] != null && fields[k] !== '') return fields[k]; } return ''; };
    let ty; let title; let desc; let cond; let reward; let penalty; let lim;
    if (hasLabel) {
        ty = g('类型'); title = (g('标题', '名称') || '').trim(); desc = g('描述', '说明'); cond = g('完成条件', '条件');
        reward = g('奖励'); penalty = g('失败惩罚', '惩罚', '罚'); lim = cleanNum(g('时限'));
    } else {
        ty = p[1]; title = (p[2] || '').trim(); desc = p[3] || ''; cond = p[4] || ''; reward = p[5] || ''; penalty = p[6] || '';
        lim = p[7] ? cleanNum(p[7]) : 0;
    }
    if (!lim) { const m = line.match(/时限\s*[：:]?\s*(\d+)/); if (m) lim = parseInt(m[1], 10) || 0; }
    if (!TASK_TYPES.includes(ty)) ty = '支线';
    // 标题为空时由结算按正文标题补；对象为空时按绑定对象补
    return { k: 'newTask', ty, title, desc, cond, reward, penalty, limit: lim, owner: fields['对象'] || fields['归属'] || '' };
}

// 数据块 → { ops, balance }。ops 顺序与块内顺序一致；新奖品/块内余额按原插件放在循环之后。
export function parseBlock(memo) {
    const lines = String(memo || '').split('\n')
        .map((l) => l.trim().replace(/^[-•·*＊]\s*|^\d+[.、)）]\s*/, ''))
        .filter((l) => l && l !== '无' && !(/^系统\s*[：:]/.test(l) && l.indexOf('|') < 0));
    const ops = [];
    const newG = [];
    let balance = null;
    for (const line of lines) {
        let p = line.split('|').map((x) => x.trim());
        if (/^积分\s*[：:]\s*\d+/.test(line)) {
            const bv = parseInt(line.replace(/^积分\s*[：:]\s*/, ''), 10);
            if (!Number.isNaN(bv)) balance = bv;
            continue;
        }
        p = normalizeParts(line, p);
        let progressAlt = null;
        if (p.length >= 3 && !TAGS_KNOWN.test(p[0]) && /^\d+$/.test(p[1]) && /^\d{1,3}\s*%?$/.test(p[2])) {
            progressAlt = p[0]; // 「标题|id|百分比」写反了：id 对不上就拿标题找
            p = ['进度'].concat(p.slice(1));
        }
        const tag = p[0];
        if (tag === '进度') ops.push({ k: 'progress', ref: p[1], alt: progressAlt, pct: p[2], why: p[3] || '' });
        else if (tag === '完成') ops.push({ k: 'done', ref: p[1] });
        else if (tag === '失败') ops.push({ k: 'fail', ref: p[1] });
        else if (tag === '新任务') ops.push(parseNewTask(p, line));
        else if (tag === '积分') ops.push({ k: 'points', raw: p[1], n: cleanNum(p[1]), reason: p[2] || '' });
        else if (tag === '属性') { if (p[1]) ops.push({ k: 'stat', name: p[1], n: cleanNum(p[2]) }); }
        else if (tag === '新奖品') { if (p[1]) newG.push({ name: p[1], tier: (p[2] || 'R'), weight: cleanNum(p[3]) || 10, desc: p[4] || '', effect: (p[5] || '') }); }
        else if (tag === '新商品') { if (p[1]) ops.push({ k: 'shopItem', name: p[1], price: cleanNum(p[2]) || 300, desc: p[3] || '', effect: (p[4] || '') }); }
        else if (tag === '获得') {
            const nm = p[1];
            if (nm) {
                const im = nm.match(/^(.+?)\s*[×xX]\s*(\d+)$/);
                if (im) ops.push({ k: 'get', name: im[1], rawName: nm, count: im[2], desc: '', inline: true });
                else ops.push({ k: 'get', name: nm, rawName: nm, count: cleanNum(p[2]) || 1, desc: p[3] || '', inline: false });
            }
        }
        else if (tag === '权限' || tag === '特权' || tag === '称号' || tag === '功能' || tag === '头衔') ops.push({ k: 'perk', name: p[1], desc: p.slice(2).join('｜'), kind: tag });
        else if (tag === '买' || tag === '购买') { if (p[1]) ops.push({ k: 'buy', name: p[1] }); }
        else if (tag === '抽奖') ops.push({ k: 'draw' });
        else if (tag === '用道具' || tag === '消耗') { if (p[1]) ops.push({ k: 'use', name: p[1], n: cleanNum(p[2]) || 1 }); }
        else if (tag === '播报') ops.push({ k: 'say', text: p.slice(1).join('｜') });
        else if (tag === '私聊') {
            const who = String(p[1] || '').trim();
            const text = p.slice(2).join('|').trim();
            if (text) ops.push({ k: 'chat', who, text });
        }
        else if (tag === '技能' || tag === '获得技能' || tag === '解锁技能') ops.push({ k: 'skill', name: p[1], desc: p.slice(2).join('｜') });
        else if (tag === '时限') ops.push({ k: 'limit', ref: p[1], n: cleanNum(p[2]) });
        else if (tag === '成就') ops.push({ k: 'achieve', name: p[1] || '成就', desc: p[2] || '', key: 'm_' + (p[1] || '') });
    }
    if (newG.length) ops.push({ k: 'gachaSet', items: newG });
    if (balance != null) ops.push({ k: 'balance', v: balance });
    return { ops, balance };
}

// ---------- 宿主生成结果的解析（商城 / 奖池 / 私聊 / 任务） ----------
const GEN_LINE = (l) => l.replace(/｜/g, '|').replace(/^[\s\d.、)）*_>\-]+/, '').trim();
const SL = (re) => (x) => String(x || '').replace(re, '').trim();

export function parseShopLines(out) {
    const sl = SL(/^(名称|价格|说明|效果|商品)\s*[：:]\s*/);
    const items = [];
    String(out || '').split('\n').forEach((l) => {
        l = GEN_LINE(l);
        if (l.indexOf('商品|') === 0) {
            const p = l.split('|').map((x) => x.trim());
            if (p[1]) items.push({ name: sl(p[1]), price: parseInt(sl(p[2]), 10) || 300, desc: sl(p[3]), effect: (sl(p[4]) && sl(p[4]) !== '无') ? sl(p[4]) : '' });
        }
    });
    return items;
}
export function parseGachaLines(out) {
    const sl = SL(/^(名称|稀有度|权重|说明|效果|奖品)\s*[：:]\s*/);
    const items = [];
    String(out || '').split('\n').forEach((l) => {
        l = GEN_LINE(l);
        if (l.indexOf('奖品|') === 0) {
            const p = l.split('|').map((x) => x.trim());
            if (p[1]) items.push({ name: sl(p[1]), tier: sl(p[2]) || 'R', weight: parseInt(sl(p[3]), 10) || 10, desc: sl(p[4]), effect: (sl(p[5]) && sl(p[5]) !== '无') ? sl(p[5]) : '' });
        }
    });
    return items;
}
export function parseRpChatLines(out) {
    const lines = [];
    String(out || '').split('\n').forEach((l) => {
        l = GEN_LINE(l);
        if (l.indexOf('私聊|') === 0) {
            const p = l.split('|');
            const who = (p[1] || '').trim();
            const text = p.slice(2).join('|').trim();
            if (text) lines.push({ who: /系统/.test(who) ? 'sys' : 'char', name: who, text });
        }
    });
    return lines;
}
export function pickTaskLine(out) {
    let line = String(out || '').split('\n').map((l) => l.trim()).find((l) => l.indexOf('新任务|') === 0);
    if (!line) { const mm = String(out || '').match(/新任务\|[^\n]+/); if (mm) line = mm[0]; }
    return line || '';
}
// 系统对话回复末尾的数据块：回复里的 <origin> 允许不闭合。
export function splitReplyBlock(reply) {
    let text = String(reply || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    let block = null;
    const mm = text.match(/<origin>([\s\S]*?)(?:<\/origin>|$)/i);
    if (mm) { block = mm[1].trim(); text = text.replace(mm[0], '').trim(); }
    text = text.replace(/^系统[：:]\s*/, '').trim();
    return { text, block };
}
