
// 检测只看正文：去掉思维链、代码块、状态栏一类的标签块。
export function cleanFloorText(text, limit = 3000) {
    let out = String(text || '');
    out = out.replace(/<(think|thinking|reasoning|status|statusbar|状态栏|details)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    out = out.replace(/```[\s\S]*?```/g, '');
    out = out.replace(/<\s*剧情推进\s*\/?\s*>/g, '');
    out = out.replace(/<[^>\n]{1,80}>/g, '');
    out = out.replace(/\n{3,}/g, '\n\n').trim();
    return out.length > limit ? out.slice(-limit) : out;
}

// 检测提示里支线钩子、进度钟、玩家自开的线的说明；threads 为 null 或都为空时不加，提示与旧版一致。
function threadRules(threads) {
    if (!threads) return null;
    const clocks = Array.isArray(threads.clocks) ? threads.clocks : [];
    const keys = [];
    const rules = [];
    if (clocks.length) {
        keys.push('"clocks":[{"name":"进度钟名称","tick":推进格数,"happened":true或false}]');
        rules.push(`clocks 对照剧情索引里的【世界进度钟】（${clocks.map(clock => `${clock.name} ${clock.filled}/${clock.total}`).join('、')}）：正文里有推动这件事的进展就填正数，每次最多 2 格；玩家出手阻止、使局势缓和就填负数；没有变化就省略。只有正文已经写出这件事发生时，happened 才填 true。`);
    }
    if (threads.hooks) {
        keys.push('"hooks":["支线名"]');
        rules.push('hooks 填【支线钩子】里标为「待触发」、出现条件已在正文中满足的支线名。支线已经在正文里演出时，把支线名填进 done；支线链只在当前这一步演出时填。');
    }
    if (threads.newThread) {
        keys.push('"newThread":{"name":"线名","summary":"一句话概括"}');
        rules.push('玩家在正文里主动开了一条大纲和剧情索引里都没有的线（例如接下新的委托、追查新的线索、发展新的关系）时填 newThread，没有就填 null。');
        const ignored = Array.isArray(threads.ignored) ? threads.ignored.slice(-10) : [];
        if (ignored.length) rules.push(`以下线已被忽略，不要再填进 newThread：${ignored.join('、')}。`);
    }
    if (clocks.length && threads.readTo > 0) {
        rules.push('标有「已读」的楼层上次检测已经读过，clocks 只按之后的新楼层推进；没有新楼层时省略 clocks 的推进。');
    }
    return keys.length ? { keys, rules, hooks: Boolean(threads.hooks), readTo: clocks.length ? Number(threads.readTo) || 0 : 0 } : null;
}

// newThread 的占位值：AI 没有新线时常写成这些。比对前去掉首尾空白与末尾标点。
const EMPTY_NAMES = /^(?:无|没有|暂无|空|none|null|nil|n\/a|na|undefined|-|—|无新线|没有新线|没有新的线)$/i;
const isEmptyName = name => EMPTY_NAMES.test(String(name).trim().replace(/[。．.！!？?；;，,、\s]+$/, '').trim());

// index 是 buildIndexText 生成的剧情索引，里面已有当前段各节点的已演/未演。threads 见 threadRules。
export function buildCheckMessages(unit, index, floors, threads = null) {
    const extra = threadRules(threads);
    const format = '{"done":["节点名"],"stageDone":true或false,"offTrack":true或false,"offReason":"偏离说明，没有就留空","reason":"一句话"}';
    const system = [
        '你是剧情进度核对员。根据最近的正文，对照剧情索引判断进度。',
        '只认正文里已经写出的事件，计划、预告、角色设想不算发生。',
        '若剧情走了某个节点的「偏转」分支，在 reason 里写明是哪个节点、怎么偏的。',
        '另外判断剧情是否严重偏离大纲：正文的走向已经和【当前】【下一段】冲突，照原计划写下去会接不上（例如关键人物已死、关键事件已不可能发生、地点或立场彻底改变）。普通的细节出入、走了偏转分支都不算严重偏离。',
        `只输出一个 JSON 对象，不加说明：${extra ? `${format.slice(0, -1)},${extra.keys.join(',')}}` : format}`,
        `done 只填${extra && extra.hooks ? '【当前】或【支线钩子】' : '【当前】'}里出现过的节点名，原样照抄；stageDone 表示当前段所有主线节点都已发生、剧情已进入下一段。`,
        ...(extra ? extra.rules : []),
    ].join('\n');
    // floor.index 是楼层下标，小于上次检测时楼数的楼上次已经读过。
    const readTo = extra ? extra.readTo : 0;
    const user = [
        `【剧情索引】\n${index}`,
        '',
        '【最近正文】',
        ...floors.map(floor => `【第 ${floor.index} 楼${readTo > 0 && floor.index < readTo ? '·已读' : ''}】\n${floor.text}`),
    ].join('\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function parseCheckReply(text) {
    const raw = String(text || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('检测结果不是 JSON');
    let value;
    try {
        value = JSON.parse(raw.slice(start, end + 1));
    } catch {
        throw new Error('检测结果 JSON 无法解析');
    }
    const done = Array.isArray(value.done) ? value.done.map(item => String(item).trim()).filter(Boolean) : [];
    const flag = item => item === true || item === 'true';
    return {
        done, stageDone: flag(value.stageDone), offTrack: flag(value.offTrack), offReason: String(value.offReason || '').trim(), reason: String(value.reason || '').trim(),
        clocks: parseClocks(value.clocks, flag), hooks: names(value.hooks), newThread: parseThread(value.newThread),
    };
}

const CLOCK_TICK_MAX = 2;
const names = list => (Array.isArray(list) ? list.map(item => String(item ?? '').trim()).filter(Boolean) : []);

// clocks 可写成数组 [{name,tick,happened}] 或映射 {名称: 格数 或 {tick,happened}}；缺字段按 0。推进夹在 -总格..+2，合并时再夹到 0..总格。
function parseClocks(raw, flag) {
    const list = Array.isArray(raw) ? raw
        : raw && typeof raw === 'object' ? Object.entries(raw).map(([name, item]) => (item && typeof item === 'object' ? { name, ...item } : { name, tick: item }))
            : [];
    return list.filter(item => item && typeof item === 'object').map(item => {
        const tick = Math.round(Number(item.tick ?? item.advance ?? item.推进));
        return { name: String(item.name ?? item.名称 ?? '').trim(), tick: Number.isFinite(tick) ? Math.min(CLOCK_TICK_MAX, tick) : 0, happened: flag(item.happened ?? item.发生) };
    }).filter(item => item.name);
}

function parseThread(raw) {
    if (!raw) return null;
    const item = typeof raw === 'string' ? { name: raw } : raw;
    if (typeof item !== 'object') return null;
    const name = String(item.name ?? item.名称 ?? '').trim().slice(0, 40);
    return name && !isEmptyName(name) ? { name, summary: String(item.summary ?? item.概括 ?? '').trim().slice(0, 200) } : null;
}

