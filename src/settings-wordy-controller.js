export function createWordyLimitController({ saveWordyLimit }) {
    const toggle = () => {
        const previous = window.__pmWordyLimit === true;
        window.__pmWordyLimit = !previous;
        if (!saveWordyLimit()) {
            window.__pmWordyLimit = previous;
            alert('短消息限制保存失败：浏览器存储不可用。');
        }
        const element = document.getElementById('pm-wordy-check');
        if (element) {
            element.classList.toggle('is-checked', window.__pmWordyLimit);
            element.setAttribute('aria-checked', String(window.__pmWordyLimit));
        }
        return window.__pmWordyLimit !== previous;
    };
    return { toggle };
}
