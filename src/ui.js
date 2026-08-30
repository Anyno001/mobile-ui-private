export function contrastText(bg) {
    if (!bg || bg.startsWith('rgba')) return '#fff';
    const color = bg.replace('#', '');
    if (color.length !== 6) return '#000';
    const r = parseInt(color.slice(0, 2), 16);
    const g = parseInt(color.slice(2, 4), 16);
    const b = parseInt(color.slice(4, 6), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#000' : '#fff';
}

export function cssUrlEscape(url) {
    return (url || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function escapeHtml(value) {
    return (value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderBoldText(value) {
    return escapeHtml(value).replace(/\*\*(?![\s*])([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
}

function renderSafeMarkdownInline(value) {
    return String(value || '').split(/(`[^`\n]+`)/g).map(part => {
        if (part.startsWith('`') && part.endsWith('`')) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        return renderBoldText(part).replace(/(^|[^*])\*(?![\s*])([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
    }).join('');
}

const markdownBlockStart = line => /^(?:```|#{1,3}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/.test(line);

export function splitMarkdownBubbles(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').trim().split('\n');
    if (lines.length === 1 && !lines[0]) return [];
    const blocks = [];
    for (let index = 0; index < lines.length;) {
        if (!lines[index].trim()) { index += 1; continue; }
        const start = index;
        if (/^```/.test(lines[index])) {
            index += 1;
            while (index < lines.length && !/^```\s*$/.test(lines[index])) index += 1;
            if (index < lines.length) index += 1;
        } else if (/^#{1,3}\s+/.test(lines[index])) {
            index += 1;
        } else if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[index])) {
            const ordered = /^\d+[.)]\s+/.test(lines[index]);
            index += 1;
            while (index < lines.length && lines[index].trim() && (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[index]) ? /^\d+[.)]\s+/.test(lines[index]) === ordered : /^\s+/.test(lines[index]))) index += 1;
        } else if (/^>\s?/.test(lines[index])) {
            index += 1;
            while (index < lines.length && /^>\s?/.test(lines[index])) index += 1;
        } else {
            index += 1;
            while (index < lines.length && lines[index].trim() && !markdownBlockStart(lines[index])) index += 1;
        }
        const block = lines.slice(start, index).join('\n').trim();
        if (block) blocks.push(block);
    }
    return blocks;
}

export function renderSafeMarkdown(value) {
    return splitMarkdownBubbles(value).map(block => {
        const lines = block.split('\n');
        const fence = lines[0].match(/^```([\w-]*)\s*$/);
        if (fence) {
            const closed = lines.length > 1 && /^```\s*$/.test(lines.at(-1));
            const code = lines.slice(1, closed ? -1 : undefined).join('\n');
            const language = fence[1] ? ` class="language-${escapeAttr(fence[1])}"` : '';
            return `<pre><code${language}>${escapeHtml(code)}</code></pre>`;
        }
        const heading = lines[0].match(/^(#{1,3})\s+(.+)$/);
        if (heading && lines.length === 1) {
            const level = heading[1].length + 2;
            return `<h${level}>${renderSafeMarkdownInline(heading[2])}</h${level}>`;
        }
        if (lines.every(line => /^>\s?/.test(line))) {
            return `<blockquote>${renderSafeMarkdownInline(lines.map(line => line.replace(/^>\s?/, '')).join('\n')).replace(/\n/g, '<br>')}</blockquote>`;
        }
        const unordered = lines.every(line => /^(?:[-*+]\s+|\s+\S)/.test(line));
        const ordered = lines.every(line => /^(?:\d+[.)]\s+|\s+\S)/.test(line));
        if (unordered || ordered) {
            const tag = ordered ? 'ol' : 'ul';
            const itemPattern = ordered ? /^\d+[.)]\s+/ : /^[-*+]\s+/;
            const items = [];
            for (const line of lines) {
                if (itemPattern.test(line)) items.push(line.replace(itemPattern, ''));
                else if (items.length) items[items.length - 1] += `\n${line.trim()}`;
            }
            return `<${tag}>${items.map(item => `<li>${renderSafeMarkdownInline(item).replace(/\n/g, '<br>')}</li>`).join('')}</${tag}>`;
        }
        return `<p>${renderSafeMarkdownInline(block).replace(/\n/g, '<br>')}</p>`;
    }).join('');
}

export function escapeAttr(value) {
    return (value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function safeJS(value) {
    const escaped = (value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return escapeAttr(escaped);
}
