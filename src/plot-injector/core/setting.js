// 设定正文按速成骨架分块：行首、以冒号结尾的行是分块标题（如「铁则:」），「[追加]」也单独成块。
const HEADING = /^(?:#{1,4}\s*)?([^\s\-*#\[][^:：]{0,30})[:：]\s*$|^(?:#{1,4}\s+)(.{1,30})$|^(\[追加\])\s*$/;

export function splitBlocks(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let current = { key: '', lines: [] };
    const counts = {};
    for (const line of lines) {
        const match = HEADING.exec(line);
        if (match) {
            if (current.key || current.lines.some(item => item.trim())) blocks.push(current);
            const title = (match[1] || match[2] || match[3]).trim();
            counts[title] = (counts[title] || 0) + 1;
            current = { key: counts[title] > 1 ? `${title}#${counts[title]}` : title, title, lines: [line] };
        } else {
            current.lines.push(line);
        }
    }
    if (current.key || current.lines.some(item => item.trim())) blocks.push(current);
    return blocks.map(block => ({ key: block.key || '开头', title: block.title || '开头', text: block.lines.join('\n').replace(/\n+$/, '') }));
}

export function joinBlocks(blocks) {
    return blocks.map(block => block.text).join('\n\n').trim();
}

// 按分块采用：keys 内的分块换成新稿，旧稿没有的新分块追加到末尾。
export function mergeBlocks(oldText, newText, keys) {
    const pick = new Set(keys);
    const oldBlocks = splitBlocks(oldText);
    const newBlocks = splitBlocks(newText);
    const newMap = new Map(newBlocks.map(block => [block.key, block]));
    const out = oldBlocks.map(block => (pick.has(block.key) && newMap.has(block.key) ? newMap.get(block.key) : block));
    const oldKeys = new Set(oldBlocks.map(block => block.key));
    for (const block of newBlocks) if (pick.has(block.key) && !oldKeys.has(block.key)) out.push(block);
    return joinBlocks(out);
}

const SECTION = /^\s*(?:#{1,4}\s*|\d+\s*[.、．]\s*|\*\*)*\s*(世界观正文|补定|速查)\s*(?:\*\*)?\s*[:：]?\s*(?:\*\*)?\s*/;

function stripFence(text) {
    const match = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/.exec(text);
    return (match ? match[1] : text).trim();
}

// 速成输出三段：世界观正文 / 补定 / 速查。没有段标题时整篇当正文。
export function parseSettingReply(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const sections = { 世界观正文: [], 补定: [], 速查: [] };
    let current = '世界观正文';
    let sawHeading = false;
    for (const line of lines) {
        const match = SECTION.exec(line);
        if (match && (match[1] !== '速查' || /PASS|FAIL/i.test(line) || line.replace(SECTION, '').trim() === '')) {
            current = match[1];
            sawHeading = true;
            const rest = line.slice(match[0].length).trim();
            if (rest) sections[current].push(rest);
            continue;
        }
        sections[current].push(line);
    }
    const body = stripFence(sections.世界观正文.join('\n'));
    const fixes = sections.补定.map(line => line.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, '').trim()).filter(Boolean);
    const verdict = /(PASS|FAIL)/i.exec([...sections.速查, ...(sawHeading ? [] : lines.slice(-3))].join(' '));
    return { body, fixes, check: verdict ? verdict[1].toUpperCase() : '' };
}

export function pushHistory(history, text, limit = 10, now = Date.now()) {
    const list = Array.isArray(history) ? history : [];
    if (list.length && list[0].text === text) return list;
    return [{ at: now, text }, ...list].slice(0, limit);
}

export function diffLines(a, b) {
    const x = String(a || '').split('\n');
    const y = String(b || '').split('\n');
    if (x.length * y.length > 4e6) return [...x.map(text => ({ op: '-', text })), ...y.map(text => ({ op: '+', text }))];
    const n = x.length;
    const m = y.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (x[i] === y[j]) { out.push({ op: '=', text: x[i] }); i += 1; j += 1; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: '-', text: x[i] }); i += 1; }
        else { out.push({ op: '+', text: y[j] }); j += 1; }
    }
    while (i < n) out.push({ op: '-', text: x[i++] });
    while (j < m) out.push({ op: '+', text: y[j++] });
    return out;
}
