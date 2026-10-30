// 生图模块行为检查：数据库生图调用、DNA 读取与解析、图片上传与目录。
// 防的是：插件返回空图/空词时误存、DNA 按卡范围存错导致换人、上传失败仍写目录、删除漏删文件。
import assert from 'node:assert/strict';
import { captionHasPromptText, findDbgenApi, generateDbgenImage } from '../src/phone-image-dbgen.js';
import { namesMentioned, phoneImageDescription } from '../src/phone-image-describe.js';
import { createImageDnaService, imageScopeKey, normalizeImageDnaStore, parseDnaResponse } from '../src/phone-image-dna.js';
import { bindingKey, createImageStore, latestForBinding, normalizeImageCatalog, uploadImage } from '../src/phone-image-store.js';
import { captionKindOf, cleanShotDescription, moduleOf } from '../src/phone-image-controller.js';
import { createPresetFrom, imageSizeFor, normalizeImageProfile, normalizeImageSettings, profileForModule } from '../src/phone-image-settings.js';
import { buildNaiRequest, foldCharsForRelay, imageFromResponse, paintNai, resolveNaiEndpoint } from '../src/phone-image-nai.js';
import { dnaTags, mergeNaiSlot } from '../src/phone-image-nai-writer.js';
import { imageCardMarkup, imageSpecialDescription } from '../src/messaging.js';
import { parseCommunityResponse } from '../src/interactive-scene-ai.js';
import { appendScenePosts, createEmptyInteractiveScope, INTERACTIVE_STORE_VERSION, normalizeInteractiveStore, normalizeScene } from '../src/interactive-scene-model.js';

const caption = { v4_prompt: { caption: { base_caption: '1girl, smile', char_captions: [] } } };
const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

// 数据库生图：写词 + 出图，空图判失败，失败带回 caption。
{
    assert.equal(findDbgenApi({}), null);
    assert.equal(captionHasPromptText(caption), true);
    assert.equal(captionHasPromptText({ v4_prompt: { caption: { base_caption: ' ', char_captions: [{ char_caption: '' }] } } }), false);
    const calls = [];
    const api = {
        generateSinglePrompt: async input => { calls.push(['write', input]); return { ok: true, value: { caption } }; },
        generate: async input => { calls.push(['paint', input]); return { ok: true, value: [{ blob: pngDataUrl, mimeType: 'image/png' }] }; },
    };
    const ok = await generateDbgenImage({ description: '窗边自拍', size: { width: 832, height: 1216 }, globalObject: { NaiDbGen: api } });
    assert.equal(ok.ok, true);
    assert.equal(ok.dataUrl, pngDataUrl);
    assert.equal(calls[0][1].skipRecall, true);
    assert.deepEqual(calls[1][1].params, { width: 832, height: 1216 });
    assert.equal(calls[1][1].replaceCharacterKeywords, true);

    const redraw = [];
    await generateDbgenImage({ caption, seed: 7, globalObject: { NaiDbGen: { ...api, generateSinglePrompt: async () => { redraw.push('write'); return {}; },
        generate: async input => { redraw.push(input.params.seed); return { ok: true, value: [{ blob: pngDataUrl }] }; } } } });
    assert.deepEqual(redraw, [7], '重画沿用原 caption，不再写词');

    const empty = await generateDbgenImage({ description: 'x', globalObject: { NaiDbGen: { ...api, generate: async () => ({ ok: true, value: [{ blob: 'data:image/png;base64,' }] }) } } });
    assert.equal(empty.ok, false);
    assert.equal(empty.caption, caption, '出图失败带回写好的词');
    const noPrompt = await generateDbgenImage({ description: 'x', globalObject: { NaiDbGen: { ...api, generateSinglePrompt: async () => ({ ok: true, value: {} }) } } });
    assert.equal(noPrompt.ok, false);
    const missing = await generateDbgenImage({ description: 'x', globalObject: {} });
    assert.match(missing.error, /未检测到数据库生图插件/);
}

// 描述：DNA 按取景选景别，缺景别回退；点名按长名优先。
{
    const text = phoneImageDescription('照片', [{ characterKey: '林夏', dna: { views: { full_body: { subject: '1girl, 1.2::black hair::', negative: 'blonde' } }, personality: '温柔' },
        outfit: { name: '校服', description: 'school uniform' } }], { framing: 'half_body' });
    assert.match(text, /全身外貌（本次半身只取可见特征）：\n1girl, 1\.2::black hair::/);
    assert.match(text, /身份排除项：\nblonde/);
    assert.match(text, /当前衣装「校服」/);
    assert.match(text, /只画画面里实际出现的人/);
    assert.equal(phoneImageDescription('照片', []), '照片');
    assert.deepEqual(namesMentioned('林夏和林夏夏在海边', ['林夏', '林夏夏', '小明']), ['林夏夏', '林夏']);
}

// DNA：手机独立保存，按角色卡分开；没有就写一份，已存的不重复写；不读其他插件的资料。
{
    assert.equal(imageScopeKey({ groupId: 'g1' }), 'group:g1');
    assert.equal(imageScopeKey({ characterId: 0, characters: [{ name: '恋爱卡' }] }), 'card:恋爱卡');

    // 即使本机有 IGS 的配置也不读：同名角色仍由手机写一份。
    const touched = [];
    const previous = globalThis.localStorage;
    globalThis.localStorage = { getItem: key => { touched.push(key); return key === 'igs_bridge_config'
        ? JSON.stringify({ sceneAssets: { characterDna: { 阿杰: { identity: 'from-igs' } } } }) : null; }, setItem: () => {} };
    let aiCalls = 0;
    let saved = null;
    const service = createImageDnaService({
        getCtx: () => ({ characterId: 0, characters: [{ name: '恋爱卡' }] }),
        callAI: async () => { aiCalls += 1; return '{"full_body":"1boy, short hair","half_body":"1boy, short hair","portrait":"1boy","negative":"","personality":"开朗"}'; },
        gatherContext: async () => { throw new Error('无法定位'); },
        readStore: async () => saved, writeStore: async value => { saved = value; return true; },
    });
    const written = await service.resolve('阿杰');
    assert.equal(touched.includes('igs_bridge_config'), false, '不读 IGS 配置');
    globalThis.localStorage = previous;
    assert.equal(written.source, 'written');
    assert.equal(aiCalls, 1);
    const again = await service.resolve('阿杰');
    assert.equal(again.source, 'phone');
    assert.equal(aiCalls, 1, '已存的 DNA 不重复写');
    assert.equal(normalizeImageDnaStore(saved).scopes['card:恋爱卡'].阿杰.dna.views.portrait.subject, '1boy');
    const readOnly = await service.resolve('路人', { allowWrite: false });
    assert.equal(readOnly.source, 'none');
    assert.throws(() => parseDnaResponse('{"full_body":"","half_body":"","portrait":""}'), /缺少外貌标签/);
}

// 上传与目录：上传失败不写目录；同一气泡取最新；删除先删文件；元数据只带路径。
{
    let catalog = null;
    const thumbs = new Map();
    const requests = [];
    let uploadOk = true;
    const ctx = { chatMetadata: {}, saveMetadataDebounced: () => { ctx.saved = (ctx.saved || 0) + 1; }, getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) };
    const fetchImpl = async (url, init) => {
        requests.push([url, JSON.parse(init.body)]);
        if (url === '/api/images/upload') return uploadOk ? { ok: true, json: async () => ({ path: `user/images/tianyin-phone/${JSON.parse(init.body).filename}.png` }) } : { ok: false, status: 500 };
        return { ok: true, status: 200 };
    };
    globalThis.crypto ??= (await import('node:crypto')).webcrypto;
    const store = createImageStore({ getCtx: () => ctx, fetchImpl,
        readCatalog: async () => catalog, writeCatalog: async value => { catalog = value; return true; },
        readThumb: async id => thumbs.get(id), writeThumb: async (id, value) => thumbs.set(id, value), deleteThumb: async id => thumbs.delete(id) });
    const source = { type: 'chat', storageId: 's1', contact: '林夏', messageId: 'm1', bubbleId: 'b1' };
    const path = await uploadImage(pngDataUrl, { getCtx: () => ctx, fetchImpl });
    assert.match(path, /^user\/images\/tianyin-phone\/[0-9a-f]{24}\.png$/);
    assert.equal(requests.at(-1)[1].ch_name, 'tianyin-phone');

    uploadOk = false;
    await assert.rejects(store.add({ dataUrl: pngDataUrl, description: '海边', source }), /上传到酒馆失败/);
    assert.equal(Object.keys(normalizeImageCatalog(catalog).records).length, 0, '上传失败不写目录');

    uploadOk = true;
    const first = await store.add({ dataUrl: pngDataUrl, description: '海边', caption, source });
    await new Promise(resolve => setTimeout(resolve, 2));
    const second = await store.add({ dataUrl: pngDataUrl, description: '海边', caption, source });
    assert.equal(latestForBinding(normalizeImageCatalog(catalog), source).id, second.id);
    assert.equal(ctx.chatMetadata.tianyin_phone_images.records.length, 2);
    assert.equal(ctx.chatMetadata.tianyin_phone_images.records[0].caption, undefined, '元数据不带提示词');

    requests.length = 0;
    await store.remove(first.id);
    assert.equal(requests.filter(([url]) => url === '/api/images/delete').length, 0, '还有别的记录用同一文件时不删文件');
    await store.remove(second.id);
    assert.deepEqual(requests.filter(([url]) => url === '/api/images/delete').map(([, body]) => body.path), [second.path]);

    const rebound = await store.add({ dataUrl: pngDataUrl, description: '自拍', source: { ...source, messageId: 'shot_x', bubbleId: '' } });
    await store.rebind(rebound.id, source);
    assert.equal(store.peekLatestFor(source).id, rebound.id);
    assert.notEqual(bindingKey(source), bindingKey({ ...source, bubbleId: 'b2' }));

    // 换设备：本机目录为空时从元数据补回。
    catalog = null;
    store.reset();
    assert.equal(await store.importFromMetadata('s1'), 1);
    assert.equal(await store.importFromMetadata('other'), 0);
}

// 聊天格式：只认「图片：描述」；拍一张的描述去掉会被暂存解析误拆的字符。
{
    assert.equal(imageSpecialDescription('图片：海边日落'), '海边日落');
    assert.equal(imageSpecialDescription('（图片：海边）'), '海边');
    assert.equal(imageSpecialDescription('语音：你好'), '');
    assert.equal(imageSpecialDescription('今天去拍了图片'), '');
    assert.equal(cleanShotDescription('自拍/海边【偷偷】(笑)'), '自拍 海边 偷偷 笑');
}

// 社区配图：AI 返回的 image（字符串或 {desc}）进帖子；非法值丢弃；严格 v3 存储往返保留，多余键拒绝。
{
    const env = items => JSON.stringify({ version: 2, kind: 'feed_batch', items });
    const comments = [{ author: '乙', content: '一' }, { author: '丙', content: '二' }];
    const parsed = parseCommunityResponse(env([
        { author: '甲', content: '下雨天', comments, image: '窗外的雨' },
        { author: '丁', content: '晴天', comments, image: { desc: '蓝天白云' } },
        { author: '戊', content: '无图', comments, image: 42 },
    ]), 'feed_batch', 'weibo');
    assert.deepEqual(parsed.items.map(item => item.image?.desc), ['窗外的雨', '蓝天白云', undefined]);
    const confess = parseCommunityResponse(env([{ author: '匿名', content: '心事', mood: '想念', comments: [], image: '路灯' }]), 'feed_batch', 'confess');
    assert.equal(confess.items[0].image.desc, '路灯');
    const night = parseCommunityResponse(env([{ author: '匿名', content: '信', to: '你', comments: [], image: '信纸' }]), 'feed_batch', 'night');
    assert.equal(night.items[0].image, undefined, '夜间来信不配图');

    const scope = createEmptyInteractiveScope();
    const scene = normalizeScene({ id: 'img-scene', platform: 'weibo', preset: 'weibo' });
    const [post] = appendScenePosts(scope, 'img-scope', scene, [{ author: '甲', content: '下雨天', comments, image: { desc: '窗外的雨' } }]);
    assert.deepEqual(post.image, { desc: '窗外的雨' });
    const raw = { version: INTERACTIVE_STORE_VERSION, scopes: { 'img-scope': { ...scope, activeSceneId: scene.id, sceneOrder: [scene.id], scenes: { [scene.id]: scene } } } };
    assert.deepEqual(normalizeInteractiveStore(JSON.parse(JSON.stringify(raw))).scopes['img-scope'].scenes[scene.id].posts[0].image, { desc: '窗外的雨' });
    const bad = JSON.parse(JSON.stringify(raw));
    bad.scopes['img-scope'].scenes[scene.id].posts[0].image.url = 'x';
    assert.throws(() => normalizeInteractiveStore(bad), /post\.image/);

    const card = imageCardMarkup('窗外的雨', { postId: post.id, author: '甲' });
    assert.match(card, /data-post-id="[^"]+" data-image-author="甲"/);
    assert.doesNotMatch(imageCardMarkup('聊天图'), /data-post-id/);
}

// 生图方案：v1 比例并进全局方案；模块选预设时整套用预设，预设被删回到全局。
{
    const v1 = normalizeImageSettings({ enabled: true, chatAuto: true, ratio: 'landscape' });
    assert.equal(v1.global.ratio, 'landscape', 'v1 的比例并进全局方案');
    assert.equal(v1.chatAuto, true);
    assert.deepEqual(v1.modules, { chat: 'global', community: 'global', video: 'global' });
    const preset = createPresetFrom(v1, '视频横图');
    const settings = normalizeImageSettings({ ...v1, presets: [{ ...preset, source: 'nai', nai: { apiKey: 'k', model: 'nai-diffusion-4-5-full' } }],
        modules: { video: preset.id, chat: 'missing' } });
    assert.equal(profileForModule(settings, 'video').source, 'nai');
    assert.equal(profileForModule(settings, 'video').ratio, 'landscape', '新预设从全局复制');
    assert.equal(profileForModule(settings, 'chat').id, 'global', '不存在的预设回到全局');
    assert.equal(profileForModule(normalizeImageSettings({ ...settings, presets: [] }), 'video').id, 'global');
    assert.deepEqual(imageSizeFor(profileForModule(settings, 'video')), { width: 1216, height: 832 });
    const bad = normalizeImageProfile({ source: 'x', nai: { steps: 999, sampler: 'nope', transport: 'x' } });
    assert.deepEqual([bad.source, bad.nai.steps, bad.nai.sampler, bad.nai.transport], ['dbgen', 50, 'k_euler_ancestral', 'auto']);
}

// 数据库生图：方案里的模型与画师串传给插件；都空时不传，插件用自己的设置。
{
    const seen = [];
    const api = { generateSinglePrompt: async () => ({ ok: true, value: { caption } }),
        generate: async input => { seen.push(input); return { ok: true, value: [{ blob: pngDataUrl }] }; } };
    await generateDbgenImage({ description: 'x', model: 'nai-diffusion-4-5-full', artist: { positive: 'artist:a', negative: '' }, globalObject: { NaiDbGen: api } });
    await generateDbgenImage({ description: 'x', artist: { positive: '', negative: '' }, globalObject: { NaiDbGen: api } });
    assert.equal(seen[0].params.model, 'nai-diffusion-4-5-full');
    assert.deepEqual(seen[0].artist, { positivePrompt: 'artist:a', negativePrompt: '' });
    assert.equal(Object.hasOwn(seen[1], 'artist'), false);
    assert.equal(seen[1].params?.model, undefined);
}

// 内置 NAI：DNA 由程序合进角色段；画师串在场景段最前；中转地址把角色词并进场景段；ZIP 响应取出 PNG。
{
    const characters = [{ characterKey: '林晚', dna: { views: { half_body: { subject: '1girl, 1.2::black hair::', negative: 'blonde hair' } } } }];
    const slot = mergeNaiSlot('{"scene":"1girl, library, rain","chars":[{"name":"林晚","tags":"smile, holding cup","outfit":"white sweater","x":0.52,"y":0.5},{"name":"路人","tags":"1boy, background"}]}', characters, 'half_body');
    assert.equal(slot.chars[0].tags, '1girl, 1.2::black hair::, white sweater, smile, holding cup', '固定外貌在前，模型只写动作');
    assert.equal(slot.chars[0].uc, 'blonde hair');
    assert.equal(slot.chars[0].x, 0.5, '坐标吸附到 NAI 网格');
    assert.equal(slot.chars[1].tags, '1boy, background', '资料里没有的人只用模型写的标签');
    assert.throws(() => mergeNaiSlot('{"scene":"","chars":[]}', characters), /没有标签/);
    assert.equal(dnaTags({ identity: 'old', triggerWords: 'tw' }).subject, 'old, tw', '旧版 DNA 字段兼容');

    const body = buildNaiRequest(slot, { artistPositive: 'artist:x', width: 832, height: 1216, seed: 5 });
    assert.equal(body.parameters.v4_prompt.caption.base_caption, 'artist:x, 1girl, library, rain');
    assert.equal(body.parameters.v4_prompt.caption.char_captions.length, 2);
    assert.equal(body.parameters.seed, 5);
    assert.match(body.parameters.negative_prompt, /lowres/, '默认负面词');
    assert.equal(foldCharsForRelay(body, '').input, body.input, '官网不并词');
    const relay = foldCharsForRelay(body, 'https://relay.example/ai/generate-image', 'artist:x');
    assert.match(relay.input, /^artist:x, 1girl, 1\.2::black hair::/, '中转：角色词插在画师串之后');
    assert.equal(resolveNaiEndpoint(''), 'https://image.novelai.net/ai/generate-image');
    assert.equal(resolveNaiEndpoint('https://relay.example'), 'https://relay.example/ai/generate-image');

    // 不压缩的 ZIP：一个 PNG 条目。
    const png = Uint8Array.from(atob(pngDataUrl.split(',')[1]), c => c.charCodeAt(0));
    const name = new TextEncoder().encode('image_0.png');
    const local = new Uint8Array(30 + name.length + png.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 0, true); lv.setUint32(18, png.length, true); lv.setUint32(22, png.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30); local.set(png, 30 + name.length);
    const zipped = await imageFromResponse(new Response(local));
    assert.equal(zipped, pngDataUrl);

    const requests = [];
    const ok = await paintNai(slot, { apiKey: 'secret', transport: 'direct', width: 832, height: 1216 },
        { fetchImpl: async (url, init) => { requests.push([url, JSON.parse(init.body), init.headers.Authorization]); return new Response(local); } });
    assert.equal(ok.ok, true);
    assert.equal(requests[0][0], 'https://image.novelai.net/ai/generate-image');
    assert.equal(requests[0][2], 'Bearer secret');
    const denied = await paintNai(slot, { apiKey: 'secret', transport: 'direct' }, { fetchImpl: async () => new Response('{"message":"bad key secret"}', { status: 401 }) });
    assert.match(denied.error, /401/);
    assert.doesNotMatch(denied.error, /secret/, '报错里不露 Key');
    const noKey = await paintNai(slot, {});
    assert.match(noKey.error, /Key/);
}

// 提示词沿用只在同一种来源之间；旧记录的 caption 视为数据库生图。
{
    assert.equal(captionKindOf({ kind: 'nai', slot: {} }), 'nai');
    assert.equal(captionKindOf(caption), 'dbgen');
    assert.equal(captionKindOf(null), '');
    assert.equal(moduleOf({ type: 'video' }), 'video');
    assert.equal(moduleOf({ type: 'chat' }), 'chat');
    assert.match(imageCardMarkup('封面', { sourceType: 'video', sceneId: 'v1', postId: 'cover', author: 'UP' }), /data-image-source="video" data-scene-id="v1"/);
}

console.log('phone image checks passed');
