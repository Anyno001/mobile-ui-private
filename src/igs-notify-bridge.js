// 新消息、新帖提醒：只调用 IGS 的通知演出，不写正文，不改 IGS 数据。
// 是否提醒与文案拼装为纯函数；IGS 调用只在 notifyIgs 一处，接口缺失或出错一律静默。
const TEXT_LIMIT = 40;

const clip = (value, max = TEXT_LIMIT) => {
    const chars = Array.from(String(value ?? '').replace(/\s+/g, ' ').trim());
    return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
};

// 联动开关（总开关与提醒开关都开着）与「用户正看着该会话」两个条件。
export function shouldNotifyIgs({ config, viewing = false } = {}) {
    return config?.enabled === true && config?.notifyOnNew === true && viewing !== true;
}

export function buildChatNotice({ isGroup = false, contactName = '', groupName = '', sentences = [], blocks = [] } = {}) {
    const sender = clip(isGroup ? (groupName || contactName) : contactName, 20);
    let text = '';
    if (isGroup) {
        const block = (blocks || []).find(item => item?.sentences?.length);
        if (block) text = `${block.name}：${block.sentences[0]}`;
    } else {
        text = sentences?.[0] || '';
    }
    text = clip(text);
    return sender && text ? { sender, text } : null;
}

export function buildFeedNotice({ appName = '', posts = [] } = {}) {
    const list = Array.isArray(posts) ? posts.filter(Boolean) : [];
    if (!appName || !list.length) return null;
    if (list.length > 1) return { sender: clip(appName, 20), text: `${list.length} 条新动态` };
    const [post] = list;
    const text = clip(post.title || post.content || '1 条新动态');
    return { sender: clip(appName, 20), text };
}

// 返回 { played } 或 null（未调用）。
export function notifyIgs({ config, viewing, notice, globalObject = globalThis } = {}) {
    if (!notice || !shouldNotifyIgs({ config, viewing })) return null;
    try {
        const show = globalObject?.IGS?.api?.notify?.show;
        if (typeof show !== 'function') return null;
        const result = globalObject.IGS.api.notify.show({ sender: notice.sender, text: notice.text });
        return result && typeof result === 'object' ? result : null;
    } catch {
        return null;
    }
}

// 社区按楼自动生成落库后的提醒回调：appNameOf(target) 由调用方给出社区界面名，出错一律静默。
export function createFeedNotifier({ getConfig, isViewing, appNameOf, globalObject = globalThis } = {}) {
    return (target, posts) => {
        try {
            notifyIgs({ config: getConfig?.(), viewing: isViewing?.(target), notice: buildFeedNotice({ appName: appNameOf?.(target), posts }), globalObject });
        } catch { /* 提醒出错不得影响生成 */ }
    };
}
