
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

// index 是 buildIndexText 生成的剧情索引，里面已有当前段各节点的已演/未演。
export function buildCheckMessages(unit, index, floors) {
    const system = [
        '你是剧情进度核对员。根据最近的正文，对照剧情索引判断进度。',
        '只认正文里已经写出的事件，计划、预告、角色设想不算发生。',
        '若剧情走了某个节点的「偏转」分支，在 reason 里写明是哪个节点、怎么偏的。',
        '另外判断剧情是否严重偏离大纲：正文的走向已经和【当前】【下一段】冲突，照原计划写下去会接不上（例如关键人物已死、关键事件已不可能发生、地点或立场彻底改变）。普通的细节出入、走了偏转分支都不算严重偏离。',
        '只输出一个 JSON 对象，不加说明：{"done":["节点名"],"stageDone":true或false,"offTrack":true或false,"offReason":"偏离说明，没有就留空","reason":"一句话"}',
        'done 只填【当前】里出现过的节点名，原样照抄；stageDone 表示当前段所有主线节点都已发生、剧情已进入下一段。',
    ].join('\n');
    const user = [
        `【剧情索引】\n${index}`,
        '',
        '【最近正文】',
        ...floors.map(floor => `【第 ${floor.index} 楼】\n${floor.text}`),
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
    return { done, stageDone: flag(value.stageDone), offTrack: flag(value.offTrack), offReason: String(value.offReason || '').trim(), reason: String(value.reason || '').trim() };
}

