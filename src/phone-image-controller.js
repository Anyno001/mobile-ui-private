// 聊天生图：图片卡状态、出图队列、大图查看与「拍一张」。
// 图片卡由 messaging.js 渲染（data-image-desc），本模块按气泡的 messageId/bubbleId 找到对应图片补上。

import { generateDbgenImage, dbgenStatus } from './phone-image-dbgen.js';
import { chatImageScene, communityImageScene, namesMentioned, phoneImageDescription } from './phone-image-describe.js';
import { createIgsDnaReader, createImageDnaService } from './phone-image-dna.js';
import { bindingKey, createImageStore, imageUrl } from './phone-image-store.js';
import { imageSizeFor, loadImageSettings, profileForModule } from './phone-image-settings.js';
import { paintNai } from './phone-image-nai.js';
import { writeNaiSlot } from './phone-image-nai-writer.js';
import { imageSpecialDescription } from './messaging.js';
import { CAMERA_ICON_SVG, CLOSE_ICON_SVG, DOWNLOAD_ICON_SVG, HOME_ICON_SVG, PHOTO_ICON_SVG, REFRESH_ICON_SVG, STAR_ICON_SVG, TRASH_ICON_SVG } from './icons.js';
import { saveDesktopBg } from './storage-background.js';
import { escapeAttr, escapeHtml } from './ui.js';

const STAGE_TEXT = { queued: '排队中', dna: '整理角色形象', write: '写提示词', paint: '出图中', upload: '保存到酒馆' };
const SHOT_LIMIT = 200;

// 图片来源属于哪个模块：决定用哪个生图方案。
export const moduleOf = source => (source?.type === 'community' ? 'community' : source?.type === 'video' ? 'video' : 'chat');
// 存下来的提示词是哪种来源写的；旧记录没有 kind，是数据库生图的原始 caption。
export const captionKindOf = caption => caption?.kind === 'nai' || caption?.kind === 'dbgen' ? caption.kind : caption?.v4_prompt ? 'dbgen' : '';

export function cleanShotDescription(value) {
    // 暂存解析会按 / 拆气泡、把 【】[] 当导演备注、把括号当特殊消息，描述里先去掉这些字符。
    return String(value || '').replace(/[\/／]/g, ' ').replace(/[【】［］\[\]()（）]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SHOT_LIMIT);
}

export function installPhoneImages(state, deps) {
    const { getCtx, getStorageId, getUserPersona, makeOverlay, closeOverlay } = deps;
    // 联动开关（总开关 + 生图读取角色形象与衣装）关着时不碰 globalThis.IGS。
    const igsDna = createIgsDnaReader({ getConfig: () => deps.igsLink?.getConfig?.() });
    const dna = createImageDnaService({ callAI: (...args) => deps.callAI(...args), gatherContext: deps.gatherContext, getCtx, getUserPersona,
        readIgsDna: (...args) => igsDna.read(...args), readIgsOutfit: (...args) => igsDna.readOutfit(...args), igsAvailable: () => igsDna.available() });
    const store = createImageStore({ getCtx });
    const jobs = new Map();
    let queue = Promise.resolve();
    let boundWindow = null;
    let lifecycle = null;
    let importedFor = '';
    // 「拍一张」生成好、还没发出去的图：storageId+联系人+描述 → 图片记录 id。
    const pendingShots = new Map();

    const userName = () => String(getUserPersona?.()?.name || '').trim() || '我';
    const currentContact = () => state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
    const shotKey = (storageId, contact, desc) => `${storageId}\u0001${contact}\u0001${desc}`;

    // 社区帖子的配图：按 sceneId/postId 关联，作者是帖子作者。
    function communityContext({ storageId, sceneId, postId, author, description, type = 'community' }) {
        return {
            fromUser: author === userName(), description, senderName: author, pending: false, storyDate: '',
            source: { type, storageId, sceneId, postId, sender: author },
        };
    }

    function cardContext(card) {
        if (card.dataset.postId) {
            return communityContext({ storageId: state.activeStorageId || getStorageId?.(),
                sceneId: card.closest('[data-scene-id]')?.dataset.sceneId || '', postId: card.dataset.postId,
                author: card.dataset.imageAuthor || '', description: card.dataset.imageDesc || '',
                type: card.dataset.imageSource === 'video' ? 'video' : 'community' });
        }
        const bubble = card.closest('.pm-bubble');
        const wrap = bubble?.closest('.pm-group-bubble-wrap');
        const side = bubble?.dataset.side || wrap?.dataset.side || (bubble?.classList.contains('pm-right') ? 'right' : 'left');
        const fromUser = side === 'right';
        const storageId = state.activeStorageId || getStorageId?.();
        const contact = currentContact();
        const description = card.dataset.imageDesc || '';
        const senderName = fromUser ? userName() : (wrap?.querySelector('.pm-group-name')?.textContent || state.currentPersona || '');
        const messageId = bubble?.dataset.messageId || '';
        const bubbleId = bubble?.dataset.bubbleId || '';
        const entry = messageId ? state.conversationHistory?.findLast?.(item => item?.messageId === messageId) : null;
        return {
            fromUser, description, senderName, pending: !messageId,
            storyDate: entry?.storyDate || '',
            source: { type: 'chat', storageId, contact, sender: senderName, messageId, bubbleId },
        };
    }

    async function characterContext({ description, senderName, fromUser, storyDate, storageId, signal, community = false }) {
        const people = state.isGroupChat ? state.groupMembers.slice() : [state.currentPersona].filter(Boolean);
        const user = userName();
        const known = new Set([...people, user]);
        const mentioned = namesMentioned(description, [...known]);
        // 社区作者多是路人网名，只给认识的人建形象；聊天里发图的人一定在场。
        const sender = fromUser ? user : senderName;
        const wanted = new Set([...(community ? (known.has(sender) ? [sender] : []) : [sender]), ...mentioned].filter(Boolean));
        if (/自拍|合照|我们/.test(description) && (!community || known.has(sender))) wanted.add(sender);
        const characters = [];
        for (const name of wanted) {
            const isUser = name === user;
            // 拍一张/重画/社区配图不带消息日期，衣装按日历「今天」取，否则当天穿搭读不到。
            characters.push(await dna.resolve(name, { isUser, storageId, storyDate: storyDate || deps.getStoryToday?.(storageId) || '', signal }));
        }
        return characters;
    }

    /** 出一张图；同一气泡同一时间只跑一次。所有任务排成一队，数据库生图本身也是串行出图。 */
    function generate(context, { caption, seed } = {}) {
        const key = bindingKey(context.source);
        if (jobs.get(key)?.running) return jobs.get(key).promise;
        const controller = new AbortController();
        const job = { running: true, stage: 'queued', error: '', caption, controller };
        jobs.set(key, job);
        refreshCards(key);
        const setStage = stage => { job.stage = stage; refreshCards(key); };
        job.promise = (queue = queue.catch(() => {}).then(async () => {
            const profile = profileForModule(loadImageSettings(), moduleOf(context.source));
            const size = imageSizeFor(profile);
            const signal = controller.signal;
            // 提示词只在同一种来源之间沿用：数据库生图的 caption 和内置 NAI 的标签格式不同。
            const reuse = [job.caption, caption].find(c => c && captionKindOf(c) === profile.source) || null;
            const community = context.source.type !== 'chat';
            const framing = community ? 'full_body' : 'half_body';
            const scene = () => community
                ? communityImageScene({ description: context.description, author: context.senderName })
                : chatImageScene({ description: context.description, sender: context.senderName, userName: userName(), fromUser: context.fromUser });
            const people = async () => { setStage('dna'); return characterContext({ ...context, community, storageId: context.source.storageId, signal }); };
            let result;
            if (profile.source === 'nai') {
                let slot = reuse?.slot;
                if (!slot) {
                    const characters = await people();
                    setStage('write');
                    slot = await writeNaiSlot({ description: scene(), characters, framing, callAI: deps.callAI, signal });
                }
                job.caption = { kind: 'nai', slot };
                setStage('paint');
                result = await paintNai(slot, { ...profile.nai, artistPositive: profile.artistPositive, artistNegative: profile.artistNegative,
                    width: size.width, height: size.height, ...(Number.isInteger(seed) && { seed }) }, { signal });
                result = { ...result, caption: job.caption };
            } else {
                const status = dbgenStatus();
                if (!status.ok) throw new Error(status.error);
                if (!reuse) job.description = phoneImageDescription(scene(), await people(), { framing });
                // 新记录包成 { kind, caption }；旧记录直接就是插件的 caption。
                const dbgenCaption = reuse ? (reuse.kind ? reuse.caption : reuse) : null;
                result = await generateDbgenImage({ description: job.description, caption: dbgenCaption, size, seed,
                    model: profile.model, artist: { positive: profile.artistPositive, negative: profile.artistNegative }, signal, onStage: setStage });
                if (result.caption) result = { ...result, caption: { kind: 'dbgen', caption: result.caption } };
                if (result.caption) job.caption = result.caption;
            }
            if (!result.ok) throw new Error(result.error);
            setStage('upload');
            return store.add({ dataUrl: result.dataUrl, description: context.description, caption: result.caption, source: context.source });
        }).then(record => {
            jobs.delete(key);
            refreshCards(key);
            return record;
        }, error => {
            job.running = false;
            job.error = error?.name === 'AbortError' ? '已停止' : (error?.message || String(error));
            refreshCards(key);
            return null;
        }));
        return job.promise;
    }

    function stop(key) { jobs.get(key)?.controller.abort(); }

    function renderCard(card) {
        const context = cardContext(card);
        const desc = escapeHtml(context.description);
        let record = null;
        if (context.pending) {
            const id = pendingShots.get(shotKey(context.source.storageId, context.source.contact, context.description));
            record = id ? store.peekRecord(id) : null;
        }
        const key = bindingKey(context.source);
        const job = context.pending ? null : jobs.get(key);
        if (!record && !context.pending) record = store.peekLatestFor(context.source);
        card.dataset.bindingKey = key;
        if (job?.running) {
            card.dataset.state = 'busy';
            card.innerHTML = `<p class="pm-img-card-desc">${desc}</p><div class="pm-img-card-status" role="status"><span class="pm-img-card-spinner" aria-hidden="true"></span>${STAGE_TEXT[job.stage] || '处理中'}<button type="button" class="pm-img-card-link" data-image-action="stop">停止</button></div>`;
        } else if (record) {
            card.dataset.state = 'done';
            card.dataset.imageId = record.id;
            card.innerHTML = `<button type="button" class="pm-img-card-photo" data-image-action="view" aria-label="查看大图：${escapeAttr(context.description)}"><img src="${escapeAttr(imageUrl(record.path))}" alt="${escapeAttr(context.description)}" loading="lazy" decoding="async"${record.width && record.height ? ` width="${record.width}" height="${record.height}"` : ''}></button>`;
        } else if (job?.error) {
            card.dataset.state = 'failed';
            card.innerHTML = `<p class="pm-img-card-desc">${desc}</p><p class="pm-img-card-error" role="alert">${escapeHtml(job.error)}</p><button type="button" class="pm-img-card-action" data-image-action="generate">${REFRESH_ICON_SVG}重试</button>`;
        } else if (context.pending) {
            card.dataset.state = 'idle';
            card.innerHTML = `<p class="pm-img-card-desc">${desc}</p>`;
        } else {
            card.dataset.state = 'idle';
            card.innerHTML = `<p class="pm-img-card-desc">${desc}</p><button type="button" class="pm-img-card-action" data-image-action="generate">${PHOTO_ICON_SVG}生成图片</button>`;
        }
    }

    function refreshCards(key) {
        const cards = boundWindow?.querySelectorAll('.pm-img-card[data-image-desc]') || [];
        for (const card of cards) if (!key || card.dataset.bindingKey === key) renderCard(card);
    }

    /** 气泡渲染后调用：补上图片卡。目录还没读进来时读完再补一次。 */
    function hydrate(nodes) {
        const cards = (Array.isArray(nodes) ? nodes : [nodes]).flatMap(node => node?.querySelectorAll
            ? [...(node.matches?.('.pm-img-card[data-image-desc]') ? [node] : []), ...node.querySelectorAll('.pm-img-card[data-image-desc]')] : []);
        if (!cards.length) return;
        // 换了聊天：先把聊天文件里带来的图片记录补进本机目录。
        const storageId = state.activeStorageId || getStorageId?.();
        if (storageId && storageId !== importedFor) {
            importedFor = storageId;
            store.importFromMetadata(storageId).then(count => { if (count) refreshCards(); }).catch(() => {});
        }
        for (const card of cards) renderCard(card);
        if (!store.isLoaded()) store.load().then(() => { for (const card of cards) if (card.isConnected) renderCard(card); });
    }

    /** 新消息落库后调用（phone-chat.js）：AI 发的图按设置自动生成；「拍一张」的图挂到刚提交的气泡上。 */
    async function noteNewEntries(entries, { storageId, saveKey }) {
        const settings = loadImageSettings();
        if (!settings.enabled) return;
        for (const entry of entries || []) {
            for (const bubble of entry?.bubbles || []) {
                const description = imageSpecialDescription(bubble.text);
                if (!description) continue;
                const source = { type: 'chat', storageId, contact: saveKey, sender: entry.role === 'user' ? userName() : (bubble.sender || state.currentPersona),
                    messageId: entry.messageId, bubbleId: bubble.bubbleId };
                if (entry.role === 'user') {
                    const key = shotKey(storageId, saveKey, description);
                    const id = pendingShots.get(key);
                    if (id) { pendingShots.delete(key); await store.rebind(id, source).catch(error => console.warn('[phone-mode] 图片挂到消息失败', error)); }
                } else if (settings.chatAuto) {
                    generate({ fromUser: false, description, senderName: source.sender, storyDate: entry.storyDate || '', source });
                }
            }
        }
        refreshCards();
    }

    /** 社区新帖落库后调用（interactive-scenes.js）：带配图描述的帖子按设置自动生成。 */
    function noteNewPosts(posts, { storageId, sceneId }) {
        const settings = loadImageSettings();
        if (!settings.enabled || !settings.communityAuto) return;
        for (const post of posts || []) {
            if (post?.image?.desc) generate(communityContext({ storageId, sceneId, postId: post.id, author: post.authorNameSnapshot || '', description: post.image.desc }));
        }
    }

    /** 视频投稿落库后调用（视频 App）：封面与各段分镜按设置自动生成。video 字段照阶段 6 规格。 */
    function noteNewVideo(video, { storageId }) {
        const settings = loadImageSettings();
        if (!settings.enabled || !settings.videoAuto || !video?.id) return;
        const author = video.uploaderNameSnapshot || '';
        const jobsFor = [video.cover?.desc && ['cover', video.cover.desc],
            ...(video.scenes || []).map((scene, index) => scene?.image?.desc && [`scene-${index}`, scene.image.desc])].filter(Boolean);
        for (const [postId, description] of jobsFor) generate(communityContext({ storageId, sceneId: video.id, postId, author, description, type: 'video' }));
    }

    function cardFor(target) { return target.closest('.pm-img-card[data-image-desc]'); }

    function onClick(event) {
        const button = event.target.closest('[data-image-action]');
        const card = button && cardFor(button);
        if (!card || !boundWindow?.contains(card)) return;
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.imageAction;
        if (action === 'generate') {
            // 重试沿用上次写好的词；文件丢失的重画沿用原记录的词。
            const context = cardContext(card);
            generate(context, { caption: jobs.get(bindingKey(context.source))?.caption || store.peekRecord(card.dataset.imageId)?.caption });
        }
        else if (action === 'stop') stop(card.dataset.bindingKey);
        else if (action === 'view' && card.dataset.imageId) openViewer(card.dataset.imageId, { opener: button });
    }

    // 文件被删或网络读不到：换回描述，提示可重画。
    function onImageError(event) {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.closest('.pm-img-card-photo')) return;
        const card = cardFor(image);
        if (!card) return;
        card.dataset.state = 'missing';
        card.innerHTML = `<p class="pm-img-card-desc">${escapeHtml(card.dataset.imageDesc)}</p><p class="pm-img-card-error">图片文件无法读取</p><button type="button" class="pm-img-card-action" data-image-action="generate">${REFRESH_ICON_SVG}重新生成</button>`;
    }

    function viewerHtml(record, message = '') {
        const meta = [record.source.sender, new Date(record.createdAt).toLocaleString()].filter(Boolean).join(' · ');
        return `<div class="pm-modal pm-modal-wide pm-image-viewer" role="dialog" aria-modal="true" aria-labelledby="pm-image-viewer-title">
  <div class="pm-modal-header"><span></span><b id="pm-image-viewer-title">图片</b><button type="button" class="pm-modal-close" data-viewer-action="close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll pm-image-viewer-body">
    <img class="pm-image-viewer-img" src="${escapeAttr(imageUrl(record.path))}" alt="${escapeAttr(record.description)}">
    <p class="pm-image-viewer-desc">${escapeHtml(record.description)}</p>
    <p class="pm-image-viewer-meta">${escapeHtml(meta)}</p>
    <p class="pm-image-viewer-status" role="status" aria-live="polite"${message ? '' : ' hidden'}>${escapeHtml(message)}</p>
  </div>
  <div class="pm-image-viewer-actions">
    <button type="button" class="pm-image-viewer-action" data-viewer-action="favorite" aria-pressed="${record.favorite}">${STAR_ICON_SVG}<span>${record.favorite ? '已收藏' : '收藏'}</span></button>
    <button type="button" class="pm-image-viewer-action" data-viewer-action="redraw">${REFRESH_ICON_SVG}<span>重画</span></button>
    <a class="pm-image-viewer-action" href="${escapeAttr(imageUrl(record.path))}" download>${DOWNLOAD_ICON_SVG}<span>下载</span></a>
    <button type="button" class="pm-image-viewer-action" data-viewer-action="wallpaper">${HOME_ICON_SVG}<span>设为桌面</span></button>
    <button type="button" class="pm-image-viewer-action is-danger" data-viewer-action="delete">${TRASH_ICON_SVG}<span>删除</span></button>
  </div>
</div>`;
    }

    async function openViewer(id, { opener, onChange } = {}) {
        const record = (await store.load()).records[id];
        if (!record) return false;
        const overlay = makeOverlay(viewerHtml(record), { opener });
        overlay.querySelector('[data-viewer-action="close"]')?.focus();
        let confirmDelete = false;
        overlay.addEventListener('click', async event => {
            const button = event.target.closest('[data-viewer-action]');
            if (!button) return;
            const action = button.dataset.viewerAction;
            const current = (await store.load()).records[id];
            if (action === 'close' || !current) return closeOverlay('close');
            if (action === 'wallpaper') {
                // 桌面背景只存图片路径（很短，放 localStorage）；图片本体仍在酒馆文件夹。
                const status = overlay.querySelector('.pm-image-viewer-status');
                const previous = window.__pmDesktopBg || '';
                window.__pmDesktopBg = imageUrl(current.path);
                try {
                    await saveDesktopBg();
                    await deps.applyBackground?.();
                    status.textContent = '已设为桌面背景。删除这张图后，桌面背景会失效。';
                } catch (error) {
                    window.__pmDesktopBg = previous;
                    status.textContent = error?.message || String(error);
                }
                status.hidden = false;
                return;
            }
            if (action === 'favorite') {
                const next = await store.update(id, { favorite: !current.favorite });
                button.setAttribute('aria-pressed', String(next.favorite));
                button.querySelector('span').textContent = next.favorite ? '已收藏' : '收藏';
                onChange?.();
            } else if (action === 'redraw') {
                closeOverlay('close');
                // 用原提示词换一个种子再出一张，挂在同一个来源上。
                generate({ fromUser: current.source.sender === userName(), description: current.description, senderName: current.source.sender,
                    storyDate: '', source: current.source }, { caption: current.caption, seed: Math.floor(Math.random() * 2 ** 32) })
                    .then(() => onChange?.());
            } else if (action === 'delete') {
                const status = overlay.querySelector('.pm-image-viewer-status');
                if (!confirmDelete) {
                    confirmDelete = true;
                    button.querySelector('span').textContent = '确认删除';
                    status.hidden = false;
                    status.textContent = '将同时删除酒馆文件夹中的图片文件。再次点击以确认。';
                    return;
                }
                try {
                    await store.remove(id);
                    closeOverlay('close');
                    refreshCards();
                    onChange?.();
                } catch (error) {
                    status.hidden = false;
                    status.textContent = error?.message || String(error);
                }
            }
        });
        return true;
    }

    /** 「拍一张」：先写描述生成预览，确认后放进输入框发送。 */
    function openShotComposer() {
        const storageId = state.activeStorageId || getStorageId?.();
        const contact = currentContact();
        if (!storageId || storageId === 'sms_unknown__default' || !contact) return alert('当前没有可发送图片的会话。');
        let recordId = '';
        let busy = false;
        const overlay = makeOverlay(`<div class="pm-modal pm-modal-wide pm-image-shot" role="dialog" aria-modal="true" aria-labelledby="pm-image-shot-title">
  <div class="pm-modal-header"><span></span><b id="pm-image-shot-title">拍一张</b><button type="button" class="pm-modal-close" data-shot-action="close" title="关闭" aria-label="关闭">${CLOSE_ICON_SVG}</button></div>
  <div class="pm-modal-scroll pm-image-shot-body">
    <label class="pm-image-shot-label" for="pm-image-shot-desc">画面内容</label>
    <textarea id="pm-image-shot-desc" class="pm-image-shot-input" maxlength="${SHOT_LIMIT}" rows="3" placeholder="例如：窗边的自拍"></textarea>
    <div class="pm-image-shot-preview" hidden></div>
    <p class="pm-image-shot-status" role="status" aria-live="polite" hidden></p>
  </div>
  <div class="pm-image-shot-actions">
    <button type="button" class="pm-action-button is-flex-1" data-shot-action="generate">${CAMERA_ICON_SVG}生成</button>
    <button type="button" class="pm-action-button is-accent is-flex-1" data-shot-action="send" disabled>发送</button>
  </div>
</div>`);
        const input = overlay.querySelector('#pm-image-shot-desc');
        const status = overlay.querySelector('.pm-image-shot-status');
        const preview = overlay.querySelector('.pm-image-shot-preview');
        const send = overlay.querySelector('[data-shot-action="send"]');
        const showStatus = message => { status.hidden = !message; status.textContent = message; };
        input.focus();
        input.addEventListener('input', () => { recordId = ''; send.disabled = true; preview.hidden = true; });
        overlay.addEventListener('click', async event => {
            const button = event.target.closest('[data-shot-action]');
            if (!button || button.disabled) return;
            const action = button.dataset.shotAction;
            if (action === 'close') return closeOverlay('close');
            const desc = cleanShotDescription(input.value);
            if (!desc) return showStatus('请先填写画面内容。');
            if (action === 'generate' && !busy) {
                busy = true;
                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                showStatus('生成中。关闭窗口后，图片仍会保存到相册。');
                const source = { type: 'chat', storageId, contact, sender: userName(), messageId: `shot_${Date.now().toString(36)}` };
                const record = await generate({ fromUser: true, description: desc, senderName: userName(), storyDate: '', source });
                busy = false;
                button.disabled = false;
                button.removeAttribute('aria-busy');
                if (!overlay.isConnected) return;
                if (!record) return showStatus(jobs.get(bindingKey(source))?.error || '生成失败');
                recordId = record.id;
                preview.hidden = false;
                preview.innerHTML = `<img src="${escapeAttr(imageUrl(record.path))}" alt="${escapeAttr(desc)}">`;
                send.disabled = false;
                showStatus('');
            } else if (action === 'send' && recordId) {
                const box = state.phoneWindow?.querySelector('.pm-input');
                if (!box) return showStatus('找不到聊天输入框。');
                const key = shotKey(storageId, contact, desc);
                pendingShots.set(key, recordId);
                closeOverlay('close');
                // 借输入框走原有暂存流程；发送成功会清空输入框，原来没发的草稿再放回去。
                const draft = box.value;
                const message = `图片：${desc}`;
                box.value = message;
                window.__pmSend?.();
                const queued = box.value !== message;
                box.value = draft;
                if (!queued) pendingShots.delete(key);
                refreshCards();
            }
        });
    }

    const bind = phoneWindow => {
        if (boundWindow === phoneWindow || typeof phoneWindow?.addEventListener !== 'function') return;
        unbind();
        boundWindow = phoneWindow;
        lifecycle = new AbortController();
        phoneWindow.addEventListener('click', onClick, { capture: true, signal: lifecycle.signal });
        phoneWindow.addEventListener('error', onImageError, { capture: true, signal: lifecycle.signal });
    };
    function unbind() {
        lifecycle?.abort();
        lifecycle = null;
        boundWindow = null;
    }
    const destroy = () => {
        unbind();
        for (const job of jobs.values()) job.controller?.abort();
        jobs.clear();
        pendingShots.clear();
        importedFor = '';
        dna.invalidate();
    };

    const api = { store, dna, generate, openViewer, openShotComposer, hydrate, noteNewEntries, noteNewPosts, noteNewVideo, refreshCards };
    Object.assign(deps, {
        bindPhoneImages: bind, destroyPhoneImages: destroy, hydrateImageCards: hydrate,
        notePhoneImageEntries: noteNewEntries, notePhoneImagePosts: noteNewPosts, notePhoneImageVideo: noteNewVideo, openPhotoShot: openShotComposer, phoneImages: api,
    });
    return api;
}
