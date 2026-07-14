export function cleanResponse(raw) {
    return (raw ?? '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
        .replace(/<inner_thought>[\s\S]*?<\/inner_thought>/gi, '')
        .replace(/<scene>[\s\S]*?<\/scene>/gi, '').replace(/<narration>[\s\S]*?<\/narration>/gi, '')
        .replace(/<action>[\s\S]*?<\/action>/gi, '').replace(/\x60{3}[\s\S]*?\x60{3}/g, '')
        .replace(/^.*【[^】]{2,}】.*$/gm, '').replace(/---+[\s\S]*$/g, '')
        .replace(/<[^>]+>/g, '').trim();
}

export function splitToSentences(str, stripFn = null) {
    const protectedText = (str || '').replace(/[\(（][^)）]*[\)）]/g, match => match.replace(/\//g, '\u0001'));
    return protectedText.split(/\s*\/\s*/).map(part => {
        let text = part.replace(/\u0001/g, '/').trim();
        if (stripFn) text = stripFn(text);
        if (!text || text === ')' || text === '）' || text === '(' || text === '（') return '';
        const opens = (text.match(/[（(]/g) || []).length;
        const closes = (text.match(/[）)]/g) || []).length;
        if (opens > closes) text += '）'.repeat(opens - closes);
        else if (closes > opens && opens === 0) text = text.replace(/^[)）]+\s*/, '').replace(/\s*[)）]+$/, '');
        return text;
    }).filter(Boolean).flatMap(text => {
        const parts = [];
        let lastIndex = 0;
        let match;
        const emojiPattern = /\[emo:[^\]]+\]/g;
        while ((match = emojiPattern.exec(text)) !== null) {
            const before = text.slice(lastIndex, match.index).trim();
            if (before) parts.push(before);
            parts.push(match[0]);
            lastIndex = match.index + match[0].length;
        }
        const after = text.slice(lastIndex).trim();
        if (after) parts.push(after);
        return parts.length ? parts : [text];
    }).filter(Boolean).slice(0, 15);
}
