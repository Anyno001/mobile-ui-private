import assert from 'node:assert/strict';
import { installConversation } from '../src/conversation.js';
import { installEmojiUi } from '../src/emoji-ui.js';
import { createBubbles } from '../src/messaging.js';
import { installPhoneFoundation } from '../src/phone-foundation.js';
import { deleteSelectedMessages } from '../src/phone-lifecycle.js';
import { splitToSentences } from '../src/prompts.js';
import { createRuntimeState } from '../src/runtime.js';
import {
    MAX_EMOJI_FILE_BYTES, MAX_EMOJI_INLINE_LIBRARY_BYTES,
    cloneEmojiLibrary, createEmojiRenderBudget, emojiDataUrlBytes, emojiFileError,
    emojiInlineBytes, emojiSourceError, isRenderableEmojiSource,
} from '../src/emoji-media.js';

const dataUrlForBytes = bytes => {
    const payload = Buffer.alloc(bytes, 1).toString('base64');
    return `data:image/gif;base64,${payload}`;
};

const exactLimit = dataUrlForBytes(MAX_EMOJI_FILE_BYTES);
const overLimit = dataUrlForBytes(MAX_EMOJI_FILE_BYTES + 1);
assert.equal(emojiDataUrlBytes(exactLimit), MAX_EMOJI_FILE_BYTES);
assert.equal(emojiDataUrlBytes(overLimit), MAX_EMOJI_FILE_BYTES + 1);
assert.equal(emojiFileError({ type: 'image/gif', size: MAX_EMOJI_FILE_BYTES }), '');
assert.match(emojiFileError({ type: 'image/gif', size: MAX_EMOJI_FILE_BYTES + 1 }), /不能超过 1 MB/);
assert.match(emojiFileError({ type: 'text/plain', size: 20 }), /只能上传图片/);
assert.equal(emojiSourceError(exactLimit, []), '');
assert.match(emojiSourceError(overLimit, []), /不能超过 1 MB/);
assert.match(emojiSourceError('data:text/plain;base64,SGVsbG8=', []), /必须是图片/);
assert.match(emojiSourceError('https://example.test/animated.gif', []), /上传本地图片/);

const sevenMiB = Array.from({ length: 7 }, (_, index) => ({ url: dataUrlForBytes(1024 * 1024), desc: String(index) }));
const library = [{ id: 'set', name: '测试', images: sevenMiB }];
assert.equal(emojiInlineBytes(library), 7 * 1024 * 1024);
assert.equal(emojiSourceError(exactLimit, library), '');
const fullLibrary = [{ id: 'set', name: '测试', images: [...sevenMiB, { url: exactLimit, desc: '8' }] }];
assert.equal(emojiInlineBytes(fullLibrary), MAX_EMOJI_INLINE_LIBRARY_BYTES);
assert.match(emojiSourceError('data:image/png;base64,AQ==', fullLibrary), /总容量不能超过 8 MB/);

const copy = cloneEmojiLibrary(library);
copy[0].images.pop();
copy[0].name = '已修改';
assert.equal(library[0].images.length, 7);
assert.equal(library[0].name, '测试');
assert.equal(copy[0].images[0].url, library[0].images[0].url, '大字符串应复用不可变值而不是 JSON 往返复制');

assert.equal(isRenderableEmojiSource(exactLimit), true);
assert.equal(isRenderableEmojiSource(overLimit), false);
assert.equal(isRenderableEmojiSource('https://example.test/emoji.gif'), false);
const budget = createEmojiRenderBudget(2 * 1024 * 1024);
assert.equal(budget(exactLimit), true);
assert.equal(budget(exactLimit), true);
assert.equal(budget('data:image/png;base64,AQ=='), false);
assert.equal(budget('https://example.test/remote.gif'), false);

class BubbleElement {
    constructor() {
        this.children = [];
        this.parentElement = null;
        this.listeners = new Map();
        this.scrollCalls = [];
        this.className = '';
        this.dataset = {};
        this.attributes = {};
        this.textContent = '';
        this._innerHTML = '';
        this.style = { removeProperty() {}, setProperty() {} };
    }
    get classList() {
        return {
            add: value => {
                const values = new Set(this.className.split(/\s+/).filter(Boolean));
                values.add(value); this.className = [...values].join(' ');
            },
            contains: value => this.className.split(/\s+/).includes(value),
            remove: value => { this.className = this.className.split(/\s+/).filter(item => item && item !== value).join(' '); },
            toggle: (value, force) => {
                const present = this.className.split(/\s+/).includes(value);
                const enabled = force === undefined ? !present : !!force;
                if (enabled && !present) this.className = `${this.className} ${value}`.trim();
                if (!enabled && present) this.className = this.className.split(/\s+/).filter(item => item && item !== value).join(' ');
                return enabled;
            },
        };
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(value) { this._innerHTML = String(value); if (!value) this.children = []; }
    get childNodes() { return this.children.length ? this.children : (this._innerHTML ? [{}] : []); }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    prepend(child) { child.parentElement = this; this.children.unshift(child); return child; }
    insertBefore(child, reference) {
        const index = this.children.indexOf(reference);
        if (index < 0) return this.appendChild(child);
        child.parentElement = this;
        this.children.splice(index, 0, child);
        return child;
    }
    replaceChildren(...children) { this.children = []; this.textContent = ''; children.forEach(child => this.appendChild(child)); }
    remove() {
        if (!this.parentElement) return;
        const index = this.parentElement.children.indexOf(this);
        if (index >= 0) this.parentElement.children.splice(index, 1);
        this.parentElement = null;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); }
    click() { this.listeners.get('click')?.({ target: this, stopPropagation() {} }); }
    focus() {}
    scrollIntoView(options) { this.scrollCalls.push(options); }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelector(selector) {
        if (selector === 'img') return this._innerHTML.includes('<img ') ? {} : null;
        if (selector === '.pm-bubble') return this.children.find(child => child.classList?.contains('pm-bubble')) || null;
        if (selector === '[data-history-index]') return this.children.find(child => child.dataset?.historyIndex !== undefined) || null;
        if (selector.includes(',')) {
            const classNames = selector.split(',').map(item => item.trim().replace(/^\./, ''));
            return this.descendants().find(child => classNames.some(className => child.classList?.contains(className))) || null;
        }
        if (selector.startsWith('.')) {
            const className = selector.slice(1);
            return this.descendants().find(child => child.classList?.contains(className)) || null;
        }
        return null;
    }
    querySelectorAll(selector) {
        if (selector === '.pm-bubble') return this.children.filter(child => child.classList?.contains('pm-bubble'));
        if (selector === '.pm-reply-card') return this.descendants().filter(child => child.classList?.contains('pm-reply-card'));
        if (selector === '.pm-select-wrap') return this.descendants().filter(child => child.classList?.contains('pm-select-wrap'));
        if (selector === '[data-history-index]') return this.descendants().filter(child => child.dataset?.historyIndex !== undefined);
        if (selector === '[data-bubble-id]') return this.descendants().filter(child => child.dataset?.bubbleId !== undefined);
        return [];
    }
    get parentNode() { return this.parentElement; }
}

const previousBubbleDocument = globalThis.document;
try {
    globalThis.document = { createElement: () => new BubbleElement() };
    const sharedBudget = createEmojiRenderBudget(2 * MAX_EMOJI_FILE_BYTES);
    const bubbleOptions = {
        groupColorMap: {}, groupMembers: [],
        emojis: [{ id: 'set', name: '测试', images: [{ url: exactLimit, desc: '大图' }] }],
        emojiBudget: sharedBudget,
    };
    const firstBubble = createBubbles('[emo:测试:1]', 'left', undefined, bubbleOptions)[0];
    const secondBubble = createBubbles('[emo:测试:1]', 'left', undefined, bubbleOptions)[0];
    const thirdBubble = createBubbles('[emo:测试:1]', 'left', undefined, bubbleOptions)[0];
    assert.match(firstBubble.innerHTML, /<img /, '共享预算内第一张聊天表情应渲染');
    assert.match(secondBubble.innerHTML, /<img /, '共享预算内第二张聊天表情应渲染');
    assert.doesNotMatch(thirdBubble.innerHTML, /<img /, '跨消息累计超预算后不得继续生成 img');
    assert.match(thirdBubble.innerHTML, /表情图片暂不加载/);
    const remoteOptions = { ...bubbleOptions, emojis: [{ id: 'remote', name: '远程', images: [{ url: 'https://example.test/huge.gif', desc: '未知大小动图' }] }] };
    const remoteBubble = createBubbles('[emo:远程:1]', 'left', undefined, remoteOptions)[0];
    assert.doesNotMatch(remoteBubble.innerHTML, /<img /, '无法验证体积的远程表情不得进入浏览器解码路径');
    assert.match(remoteBubble.innerHTML, /表情图片暂不加载/);

    const specialOptions = { groupColorMap: {}, groupMembers: [], emojis: [] };
    assert.match(createBubbles('(语音+你好)', 'left', undefined, specialOptions)[0].innerHTML, /pm-voice-card/, '旧括号语音格式必须继续渲染');
    assert.match(createBubbles('（图片：风景）', 'left', undefined, specialOptions)[0].innerHTML, /pm-img-card/, '旧中文括号图片格式必须继续渲染');
    assert.match(createBubbles('(转账+88)', 'left', undefined, specialOptions)[0].innerHTML, /¥88\.00/, '旧括号转账格式必须继续渲染');
    assert.match(createBubbles('(收款+12.5)', 'left', undefined, specialOptions)[0].innerHTML, /¥12\.50/, '旧括号收款格式必须继续渲染');
    assert.match(createBubbles('(退还+20)', 'left', undefined, specialOptions)[0].innerHTML, /¥20\.00/, '旧括号退还格式必须继续渲染');
    const mixedLegacy = createBubbles('看看 (图片+风景) 了吗', 'left', undefined, specialOptions);
    assert.equal(mixedLegacy.length, 3, '旧括号格式必须继续支持与普通文本混排');
    assert.match(mixedLegacy[1].innerHTML, /pm-img-card/, '旧括号格式混排时图片卡片必须继续渲染');
    for (const input of ['(转账+给你)', '（收款：-1）', '(退还+88元)']) {
        const plainBubble = createBubbles(input, 'left', undefined, specialOptions)[0];
        assert.doesNotMatch(plainBubble.className, /pm-special/, `无效括号金额不得伪造交易卡片：${JSON.stringify(input)}`);
    }
    for (const input of ['(语音+)', '（图片：）', '(语音   )', '（图片：   ）']) {
        const plainBubble = createBubbles(input, 'left', undefined, specialOptions)[0];
        assert.doesNotMatch(plainBubble.className, /pm-special/, `空括号特殊消息不得渲染卡片：${JSON.stringify(input)}`);
    }
    for (const input of ['(图片很好看)', '（语音很好听）']) {
        const plainBubble = createBubbles(input, 'left', undefined, specialOptions)[0];
        assert.doesNotMatch(plainBubble.className, /pm-special/, `无分隔符的括号自然语言不得误识别：${JSON.stringify(input)}`);
    }

    assert.match(createBubbles('语音 你好', 'left', undefined, specialOptions)[0].innerHTML, /pm-voice-card/, '无括号空格语音格式必须渲染');
    assert.match(createBubbles('图片：风景', 'left', undefined, specialOptions)[0].innerHTML, /pm-img-card/, '无括号中文冒号图片格式必须渲染');
    assert.match(createBubbles('转账 88', 'left', undefined, specialOptions)[0].innerHTML, /¥88\.00/, '无括号空格转账格式必须渲染');
    assert.match(createBubbles('收款: 12.5', 'left', undefined, specialOptions)[0].innerHTML, /¥12\.50/, '无括号英文冒号收款格式必须渲染');
    assert.match(createBubbles('退还+20', 'left', undefined, specialOptions)[0].innerHTML, /¥20\.00/, '无括号加号退还格式必须渲染');
    assert.deepEqual(splitToSentences('语音 你好 / 普通消息'), ['语音 你好', '普通消息'], '无括号特殊消息必须可作为 / 分隔片段传递给渲染器');

    const groupVoice = createBubbles('语音 你好', 'left', '小明', {
        ...specialOptions,
        groupColorMap: { 小明: '#123456' },
        groupMembers: ['小明'],
    })[0];
    assert.match(groupVoice.className, /pm-group-bubble-wrap/, '群聊无括号特殊消息必须保留成员包装');
    assert.equal(groupVoice.children[0].textContent, '小明', '群聊无括号特殊消息不得丢失成员名称');
    assert.match(groupVoice.children[1].className, /pm-special/, '群聊无括号特殊消息必须保留特殊气泡');
    assert.match(groupVoice.children[1].innerHTML, /pm-voice-group/, '群聊无括号语音必须保留成员颜色分支');

    for (const input of ['语音   ', '图片:', '图片：   ', '转账+', '收款:\t', '退还 \t']) {
        const plainBubble = createBubbles(input, 'left', undefined, specialOptions)[0];
        assert.doesNotMatch(plainBubble.className, /pm-special/, `空白内容不得渲染特殊消息：${JSON.stringify(input)}`);
        assert.equal(plainBubble.innerHTML, input.trim(), `空白内容必须保留为普通文本：${JSON.stringify(input)}`);
    }

    const plainPicture = createBubbles('图片很好看', 'left', undefined, specialOptions)[0];
    const plainVoice = createBubbles('语音很好听', 'left', undefined, specialOptions)[0];
    const embeddedPicture = createBubbles('这是图片：描述', 'left', undefined, specialOptions)[0];
    assert.doesNotMatch(plainPicture.className, /pm-special/, '无分隔符的图片自然语言不得误识别');
    assert.doesNotMatch(plainVoice.className, /pm-special/, '无分隔符的语音自然语言不得误识别');
    assert.doesNotMatch(embeddedPicture.className, /pm-special/, '非消息开头的特殊关键词不得误识别');
    for (const input of ['转账 给你', '收款 明天再说', '退还 abc', '转账 88元', '收款 -1']) {
        const plainBubble = createBubbles(input, 'left', undefined, specialOptions)[0];
        assert.doesNotMatch(plainBubble.className, /pm-special/, `无效无括号金额不得伪造交易卡片：${JSON.stringify(input)}`);
    }
} finally {
    if (previousBubbleDocument === undefined) delete globalThis.document;
    else globalThis.document = previousBubbleDocument;
}

const previousIntegrationWindow = globalThis.window;
const previousIntegrationDocument = globalThis.document;
const previousIntegrationLocalStorage = globalThis.localStorage;
const previousAnimationFrame = globalThis.requestAnimationFrame;
const previousMatchMedia = globalThis.matchMedia;
const previousIntegrationSetTimeout = globalThis.setTimeout;
const previousIntegrationClearTimeout = globalThis.clearTimeout;
try {
    const messageList = new BubbleElement();
    messageList.scrollHeight = 0;
    messageList.scrollTop = 0;
    const nameNode = new BubbleElement();
    nameNode.scrollWidth = 10;
    nameNode.clientWidth = 100;
    const editNode = new BubbleElement();
    const quotePreview = new BubbleElement();
    quotePreview.className = 'pm-quote-preview';
    quotePreview.hidden = true;
    const quotePreviewSender = new BubbleElement();
    quotePreviewSender.className = 'pm-quote-preview-sender';
    const quotePreviewText = new BubbleElement();
    quotePreviewText.className = 'pm-quote-preview-text';
    quotePreview.append(quotePreviewSender, quotePreviewText);
    const inputNode = new BubbleElement();
    inputNode.focused = false;
    inputNode.focus = () => { inputNode.focused = true; };
    const phoneStyle = { removeProperty() {}, setProperty() {} };
    const phoneWindow = {
        style: phoneStyle,
        querySelector(selector) {
            if (selector === '.pm-msg-list') return messageList;
            if (selector === '.pm-name') return nameNode;
            if (selector === '.pm-name-edit') return editNode;
            if (selector === '.pm-quote-preview') return quotePreview;
            if (selector === '.pm-input') return inputNode;
            return null;
        },
    };
    const documentListeners = new Map();
    globalThis.document = {
        activeElement: null,
        body: new BubbleElement(),
        visibilityState: 'visible',
        addEventListener: (name, handler) => documentListeners.set(name, handler),
        createElement: () => new BubbleElement(),
        createTextNode: text => { const node = new BubbleElement(); node.textContent = String(text); return node; },
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    };
    const windowListeners = new Map();
    globalThis.window = {
        addEventListener(name, handler) {
            if (!windowListeners.has(name)) windowListeners.set(name, new Set());
            windowListeners.get(name).add(handler);
        },
        removeEventListener(name, handler) { windowListeners.get(name)?.delete(handler); },
        __pmEmojis: [{ id: 'set', name: '测试', images: [{ url: exactLimit, desc: '大图' }] }],
        __pmHistories: {
            story: {
                Alice: Array.from({ length: 5 }, () => ({ role: 'assistant', content: '[emo:测试:1]' })),
                Bob: [{ role: 'assistant', content: '[emo:测试:1]' }],
                group: [{ role: 'assistant', content: Array.from({ length: 5 }, () => 'Alice: [emo:测试:1]').join('\n') }],
            },
        },
        __pmGroupMeta: {},
    };
    globalThis.localStorage = {
        getItem: () => null,
        setItem() {},
    };
    globalThis.requestAnimationFrame = callback => callback();
    globalThis.matchMedia = () => ({ matches: false });
    let nextTimerId = 0;
    const pendingTimers = new Map();
    globalThis.setTimeout = callback => {
        const timerId = ++nextTimerId;
        pendingTimers.set(timerId, callback);
        return timerId;
    };
    globalThis.clearTimeout = timerId => pendingTimers.delete(timerId);

    const state = {
        phoneWindow,
        phoneActive: true,
        activeStorageId: 'story',
        currentPersona: '',
        conversationHistory: [],
        generationSequence: 0,
        generationTask: null,
        groupColorMap: {},
        groupDisplayName: '',
        groupExtras: [],
        groupMembers: [],
        hostEpoch: 0,
        isGenerating: false,
        isGroupChat: false,
        isMinimized: false,
        activeQuote: null,
    };
    const deps = {
        runtime: createRuntimeState(),
        getCtx: () => null,
        getStorageId: () => 'story',
        getUserPersona: () => ({ name: '用户' }),
    };
    installPhoneFoundation(state, deps);
    installConversation(state, deps);
    const wrapForSelection = (root, checked) => {
        const wrap = new BubbleElement();
        wrap.className = 'pm-select-wrap';
        wrap.dataset.historyIndex = root.dataset.historyIndex;
        const checkbox = new BubbleElement();
        checkbox.className = 'pm-message-select-check';
        checkbox.dataset.checked = checked ? '1' : '0';
        const index = messageList.children.indexOf(root);
        messageList.children.splice(index, 1, wrap);
        wrap.parentElement = messageList;
        wrap.append(checkbox, root);
        return wrap;
    };
    const imageCount = () => messageList.children.reduce((total, node) => {
        const bubbles = node.classList?.contains('pm-group-bubble-wrap') ? node.querySelectorAll('.pm-bubble') : [node];
        return total + bubbles.filter(bubble => bubble.innerHTML?.includes('<img ')).length;
    }, 0);
    const placeholderCount = () => messageList.children.reduce((total, node) => {
        const bubbles = node.classList?.contains('pm-group-bubble-wrap') ? node.querySelectorAll('.pm-bubble') : [node];
        return total + bubbles.filter(bubble => bubble.innerHTML?.includes('表情图片暂不加载')).length;
    }, 0);

    window.__pmSwitch('Alice');
    assert.equal(imageCount(), 4, '全量历史重绘必须共享 4 MB 表情预算');
    assert.equal(placeholderCount(), 1, '历史中超预算表情应降级为占位');
    deps.addBubble('[emo:测试:1]', 'left');
    assert.equal(imageCount(), 4, '增量消息不得重置当前联系人预算');
    assert.equal(placeholderCount(), 2);

    messageList.innerHTML = '';
    state.isGroupChat = false;
    state.currentPersona = 'Alice';
    const privateNodes = deps.addBubble('私聊可引用目标', 'left', undefined, 0, {
        historyIndex: 0, messageId: 'msg_private_target', bubbleId: 'bubble_private_target', sender: 'Alice',
    });
    const privateQuoteAction = privateNodes[0].querySelector('.pm-quote-action');
    assert.ok(privateQuoteAction, '私聊稳定气泡必须提供引用操作');
    privateQuoteAction.click();
    assert.deepEqual(state.activeQuote, {
        messageId: 'msg_private_target', bubbleId: 'bubble_private_target', sender: 'Alice', text: '私聊可引用目标',
    }, '私聊引用必须写入与群聊一致的稳定快照');
    assert.equal(quotePreview.hidden, false, '私聊引用后必须显示输入区预览');
    deps.clearActiveQuote();
    assert.equal(quotePreview.hidden, true, '取消私聊引用必须清空预览');

    window.__pmSwitch('Bob');
    assert.equal(imageCount(), 1, '切换联系人后必须在历史重放前重置预算');

    state.isGroupChat = true;
    state.currentGroupKey = 'group';
    state.groupDisplayName = '测试群聊标题不会被截断';
    state.groupMembers = ['Alice'];
    state.groupColorMap = { Alice: '#f26d85' };
    state.currentPersona = '';
    window.__pmSwitch('group');
    assert.equal(nameNode.textContent, '测试群聊标题不会被截断', '群聊标题必须保留完整文本，由响应式布局负责换行');
    assert.equal(imageCount(), 4, '群聊 wrapper 必须参与共享预算累计');
    assert.equal(placeholderCount(), 1, '群聊超预算表情应降级为占位');
    assert.equal(window.__pmHistories.story.Alice.length, 5, '渲染预算不得修改聊天历史');
    assert.equal(window.__pmEmojis[0].images.length, 1, '渲染预算不得删除表情数据');

    messageList.innerHTML = '';
    const targetNodes = deps.addBubble('可定位目标', 'left', 'Alice', 0, {
        historyIndex: 0, messageId: 'msg_target', bubbleId: 'bubble_target', sender: 'Alice',
    });
    const targetRoot = targetNodes[0];
    const quoteAction = targetRoot.querySelector('.pm-quote-action');
    assert.ok(quoteAction, '群聊稳定气泡必须提供引用操作');
    quoteAction.click();
    assert.deepEqual(state.activeQuote, {
        messageId: 'msg_target', bubbleId: 'bubble_target', sender: 'Alice', text: '可定位目标',
    }, '点击引用必须写入稳定 ID 与展示快照');
    assert.equal(quotePreview.hidden, false, '点击引用后必须显示输入区引用预览');
    assert.equal(quotePreviewSender.children[0].textContent, 'Alice');
    assert.equal(quotePreviewText.children[0].textContent, '可定位目标');
    assert.equal(inputNode.focused, true, '选择引用后必须把焦点返回输入框');

    const quotedNodes = deps.addBubble('回复目标', 'right', undefined, 1, {
        historyIndex: 1, messageId: 'msg_reply', bubbleId: 'bubble_reply', sender: '我',
        quote: state.activeQuote,
    });
    const replyCard = quotedNodes[0].querySelector('.pm-reply-card');
    assert.ok(replyCard, '带 quote 的历史气泡必须渲染引用卡片');
    assert.equal(replyCard.disabled, false, '目标存在时引用卡片必须可定位');
    replyCard.click();
    const targetWithScroll = messageList.querySelectorAll('[data-bubble-id]')
        .find(node => node.dataset.messageId === 'msg_target' && node.scrollCalls.length > 0);
    assert.ok(targetWithScroll, '点击引用卡片必须定位到 messageId 与 bubbleId 同时匹配的目标');
    assert.deepEqual(targetWithScroll.scrollCalls[0], { behavior: 'smooth', block: 'center' });
    assert.equal(targetWithScroll.classList.contains('pm-quote-target'), true, '定位目标必须临时高亮');
    globalThis.matchMedia = query => ({ matches: query === '(prefers-reduced-motion: reduce)' });
    replyCard.click();
    assert.deepEqual(targetWithScroll.scrollCalls.at(-1), { behavior: 'auto', block: 'center' },
        '减少动态效果时引用定位不得强制平滑滚动');
    globalThis.matchMedia = () => ({ matches: false });
    assert.equal(pendingTimers.size, 1, '重复定位必须取消旧的引用高亮定时器');
    deps.clearQuoteHighlight();
    assert.equal(pendingTimers.size, 0, '关闭路径使用的引用高亮清理必须取消定时器');
    assert.equal(targetWithScroll.classList.contains('pm-quote-target'), false, '清理必须移除引用高亮样式');
    const blurListenersBeforeWrappedRebase = windowListeners.get('blur')?.size || 0;
    wrapForSelection(targetRoot, false);
    deps.rebaseRenderedHistory(1);
    assert.equal(windowListeners.get('blur')?.size || 0, blurListenersBeforeWrappedRebase - 1,
        '多选 wrapper 中被裁剪的气泡必须解绑全局 blur 监听器');
    assert.equal(replyCard.disabled, true, '被引用目标裁剪后，现存引用卡片必须立即禁用定位');
    assert.equal(replyCard.classList.contains('is-missing'), true);
    assert.equal(replyCard.attributes['aria-disabled'], 'true');
    assert.equal(replyCard.attributes['aria-label'], '原消息已删除或已被裁剪，当前显示引用快照');
    assert.equal(messageList.children.includes(targetRoot), false, '历史重排必须移除已裁剪目标节点');
    assert.equal(quotedNodes[0].dataset.historyIndex, '0', '裁剪后保留消息的历史下标必须重排');

    messageList.innerHTML = '';
    state.conversationHistory = [
        { role: 'assistant', content: '待删除目标' },
        { role: 'assistant', content: '保留消息' },
        { role: 'user', content: '引用回复' },
    ];
    const deleteTargetNodes = deps.addBubble('待删除目标', 'left', 'Alice', 0, {
        historyIndex: 0, messageId: 'msg_delete_target', bubbleId: 'bubble_delete_target', sender: 'Alice',
    });
    const retainedNodes = deps.addBubble('保留消息', 'left', 'Bob', 1, {
        historyIndex: 1, messageId: 'msg_retained', bubbleId: 'bubble_retained', sender: 'Bob',
    });
    const retainedReplyNodes = deps.addBubble('引用回复', 'right', undefined, 2, {
        historyIndex: 2, messageId: 'msg_retained_reply', bubbleId: 'bubble_retained_reply', sender: '我',
        quote: { messageId: 'msg_delete_target', bubbleId: 'bubble_delete_target', sender: 'Alice', text: '待删除目标' },
    });
    const deletedTargetRoot = deleteTargetNodes[0];
    const retainedRoot = retainedNodes[0];
    const retainedReplyRoot = retainedReplyNodes[0];
    const retainedReplyCard = retainedReplyRoot.querySelector('.pm-reply-card');
    wrapForSelection(deletedTargetRoot, true);
    wrapForSelection(retainedRoot, false);
    wrapForSelection(retainedReplyRoot, false);
    let deletePersistCalls = 0;
    let deleteInjectionCalls = 0;
    const blurListenersBeforeDelete = windowListeners.get('blur')?.size || 0;
    assert.equal(deleteSelectedMessages({
        state,
        refreshReplyCardAvailability: deps.refreshReplyCardAvailability,
        persistCurrentHistory: () => { deletePersistCalls += 1; },
        applyBidirectionalInjection: () => { deleteInjectionCalls += 1; },
        clearBubbleQuoteGesture: deps.clearBubbleQuoteGesture,
    }), 1, '多选删除必须按稳定 historyIndex 删除一个历史 entry');
    assert.equal(windowListeners.get('blur')?.size || 0, blurListenersBeforeDelete - 1,
        '多选删除必须解绑被删除气泡的全局 blur 监听器');
    assert.deepEqual(state.conversationHistory.map(item => item.content), ['保留消息', '引用回复']);
    assert.equal(messageList.children.includes(deletedTargetRoot), false);
    assert.equal(messageList.children.includes(retainedRoot), true, '未选消息必须从选择 wrapper 中还原');
    assert.equal(retainedRoot.dataset.historyIndex, '0');
    assert.equal(retainedReplyRoot.dataset.historyIndex, '1');
    assert.equal(retainedReplyCard.disabled, true, '多选删除引用目标后，引用卡必须在持久化前立即失效');
    assert.equal(retainedReplyCard.classList.contains('is-missing'), true);
    assert.equal(retainedReplyCard.attributes['aria-disabled'], 'true');
    assert.equal(deletePersistCalls, 1);
    assert.equal(deleteInjectionCalls, 1);

    const missingNodes = deps.addBubble('目标已裁剪', 'right', undefined, 2, {
        historyIndex: 2, messageId: 'msg_missing_reply', bubbleId: 'bubble_missing_reply', sender: '我',
        quote: { messageId: 'msg_gone', bubbleId: 'bubble_gone', sender: 'Bob', text: '保留的快照' },
    });
    const missingCard = missingNodes[0].querySelector('.pm-reply-card');
    assert.equal(missingCard.disabled, true, '目标缺失时引用卡片首屏即应禁用定位');
    assert.equal(missingCard.classList.contains('is-missing'), true);
    assert.equal(missingCard.attributes['aria-label'], '原消息已删除或已被裁剪，当前显示引用快照');
    assert.equal(missingCard.querySelector('.pm-reply-card-text').textContent, '保留的快照');
} finally {
    if (previousIntegrationWindow === undefined) delete globalThis.window; else globalThis.window = previousIntegrationWindow;
    if (previousIntegrationDocument === undefined) delete globalThis.document; else globalThis.document = previousIntegrationDocument;
    if (previousIntegrationLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousIntegrationLocalStorage;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previousAnimationFrame;
    if (previousMatchMedia === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = previousMatchMedia;
    if (previousIntegrationSetTimeout === undefined) delete globalThis.setTimeout; else globalThis.setTimeout = previousIntegrationSetTimeout;
    if (previousIntegrationClearTimeout === undefined) delete globalThis.clearTimeout; else globalThis.clearTimeout = previousIntegrationClearTimeout;
}

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
const previousAlert = globalThis.alert;
const previousFileReader = globalThis.FileReader;
try {
    const alerts = [];
    let fileReaderConstructed = 0;
    let fileReads = 0;
    let saves = 0;
    const elements = new Map([
        ['pm-emo-url', { value: '' }],
        ['pm-emo-desc', { value: '测试表情' }],
        ['pm-emo-preview', {
            className: '',
            classList: {
                add(name) {
                    this.owner.className = `${this.owner.className} ${name}`.trim();
                },
                owner: null,
            },
        }],
        ['pm-emo-preview-img', { src: '' }],
    ]);
    elements.get('pm-emo-preview').classList.owner = elements.get('pm-emo-preview');
    globalThis.window = { __pmEmojis: [{ id: 'set', name: '测试', images: [] }] };
    globalThis.document = {
        getElementById: id => elements.get(id) || null,
        querySelector: () => null,
    };
    globalThis.alert = message => alerts.push(String(message));
    globalThis.FileReader = class FakeFileReader {
        constructor() { fileReaderConstructed += 1; this.onload = null; }
        readAsDataURL() {
            fileReads += 1;
            this.onload?.({ target: { result: exactLimit } });
        }
    };
    installEmojiUi({ makeOverlay: () => {}, saveEmojis: async () => { saves += 1; } });

    const oversizedInput = { files: [{ type: 'image/gif', size: MAX_EMOJI_FILE_BYTES + 1 }], value: 'large.gif' };
    window.__pmEmoFileRead(0, oversizedInput);
    assert.equal(fileReaderConstructed, 0, '超限文件必须在创建 FileReader 前拒绝');
    assert.equal(fileReads, 0);
    assert.equal(oversizedInput.value, '');
    assert.match(alerts.at(-1), /不能超过 1 MB/);

    const acceptedInput = { files: [{ type: 'image/gif', size: MAX_EMOJI_FILE_BYTES }], value: 'allowed.gif' };
    window.__pmEmoFileRead(0, acceptedInput);
    assert.equal(fileReaderConstructed, 1);
    assert.equal(fileReads, 1);
    assert.equal(elements.get('pm-emo-preview').className, 'is-visible', '文件预览必须由 CSS class 显示，不能写入稳定 inline display');

    elements.get('pm-emo-url').value = overLimit;
    await window.__pmConfirmAddEmojiImage(0);
    assert.equal(saves, 0, '超限 data URL 不得进入保存路径');
    assert.equal(window.__pmEmojis[0].images.length, 0);
    elements.get('pm-emo-url').value = 'https://example.test/animated.gif';
    await window.__pmConfirmAddEmojiImage(0);
    assert.equal(saves, 0, '远程表情不得进入保存路径');
    assert.equal(window.__pmEmojis[0].images.length, 0);
    assert.match(alerts.at(-1), /上传本地图片/);
} finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousAlert === undefined) delete globalThis.alert; else globalThis.alert = previousAlert;
    if (previousFileReader === undefined) delete globalThis.FileReader; else globalThis.FileReader = previousFileReader;
}
console.log('Emoji media safety verified.');
