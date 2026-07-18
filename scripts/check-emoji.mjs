import assert from 'node:assert/strict';
import { installConversation } from '../src/conversation.js';
import { installEmojiUi } from '../src/emoji-ui.js';
import { createBubbles } from '../src/messaging.js';
import { installPhoneFoundation } from '../src/phone-foundation.js';
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
        this.className = '';
        this.dataset = {};
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
        };
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(value) { this._innerHTML = String(value); if (!value) this.children = []; }
    get childNodes() { return this.children.length ? this.children : (this._innerHTML ? [{}] : []); }
    appendChild(child) { this.children.push(child); return child; }
    querySelector(selector) {
        if (selector === 'img') return this._innerHTML.includes('<img ') ? {} : null;
        if (selector === '.pm-bubble') return this.children.find(child => child.classList?.contains('pm-bubble')) || null;
        if (selector === '[data-history-index]') return this.children.find(child => child.dataset?.historyIndex !== undefined) || null;
        return null;
    }
    querySelectorAll(selector) {
        if (selector === '.pm-bubble') return this.children.filter(child => child.classList?.contains('pm-bubble'));
        if (selector === '[data-history-index]') return this.children.filter(child => child.dataset?.historyIndex !== undefined);
        return [];
    }
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
} finally {
    if (previousBubbleDocument === undefined) delete globalThis.document;
    else globalThis.document = previousBubbleDocument;
}

const previousIntegrationWindow = globalThis.window;
const previousIntegrationDocument = globalThis.document;
const previousIntegrationLocalStorage = globalThis.localStorage;
const previousAnimationFrame = globalThis.requestAnimationFrame;
try {
    const messageList = new BubbleElement();
    messageList.scrollHeight = 0;
    messageList.scrollTop = 0;
    const nameNode = new BubbleElement();
    nameNode.scrollWidth = 10;
    nameNode.clientWidth = 100;
    const editNode = new BubbleElement();
    const phoneStyle = { removeProperty() {}, setProperty() {} };
    const phoneWindow = {
        style: phoneStyle,
        querySelector(selector) {
            if (selector === '.pm-msg-list') return messageList;
            if (selector === '.pm-name') return nameNode;
            if (selector === '.pm-name-edit') return editNode;
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
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    };
    globalThis.window = {
        addEventListener() {},
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
    };
    const deps = {
        runtime: createRuntimeState(),
        getCtx: () => null,
        getStorageId: () => 'story',
        getUserPersona: () => ({ name: '用户' }),
    };
    installPhoneFoundation(state, deps);
    installConversation(state, deps);
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

    window.__pmSwitch('Bob');
    assert.equal(imageCount(), 1, '切换联系人后必须在历史重放前重置预算');

    state.isGroupChat = true;
    state.currentGroupKey = 'group';
    state.groupDisplayName = '测试群';
    state.groupMembers = ['Alice'];
    state.groupColorMap = { Alice: '#f26d85' };
    state.currentPersona = '';
    window.__pmSwitch('group');
    assert.equal(imageCount(), 4, '群聊 wrapper 必须参与共享预算累计');
    assert.equal(placeholderCount(), 1, '群聊超预算表情应降级为占位');
    assert.equal(window.__pmHistories.story.Alice.length, 5, '渲染预算不得修改聊天历史');
    assert.equal(window.__pmEmojis[0].images.length, 1, '渲染预算不得删除表情数据');
} finally {
    if (previousIntegrationWindow === undefined) delete globalThis.window; else globalThis.window = previousIntegrationWindow;
    if (previousIntegrationDocument === undefined) delete globalThis.document; else globalThis.document = previousIntegrationDocument;
    if (previousIntegrationLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousIntegrationLocalStorage;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previousAnimationFrame;
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
        ['pm-emo-preview', { style: { display: 'none' } }],
        ['pm-emo-preview-img', { src: '' }],
    ]);
    globalThis.window = { __pmEmojis: [{ id: 'set', name: '测试', images: [] }] };
    globalThis.document = {
        getElementById: id => elements.get(id) || null,
        querySelector: () => null,
    };
    globalThis.alert = message => alerts.push(String(message));
    globalThis.FileReader = class FakeFileReader {
        constructor() { fileReaderConstructed += 1; }
        readAsDataURL() { fileReads += 1; }
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
