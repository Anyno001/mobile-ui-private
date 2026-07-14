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

export function escapeAttr(value) {
    return (value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function safeJS(value) {
    const escaped = (value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return escapeAttr(escaped);
}
