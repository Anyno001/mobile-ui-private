// 角色 DNA：手机独立保存，不读写其他插件的资料。没有就用手机的 API 写一份，按角色卡（群聊按群）分开存。
// 结构沿用 IGS scene/character-dna.js：{ version:2, views:{ full_body|half_body|portrait:{subject,negative} }, personality }。

import { parseFirstJsonObject } from './ai.js';
import { pmIDBGet, pmIDBSet } from './storage-primitives.js';
import { OUTFIT_SELF_SUBJECT, outfitForDate, outfitScopeFor } from './calendar-outfit-model.js';
import { loadOutfitStore } from './calendar-outfit-runtime.js';
import { IMAGE_DNA_STORE_KEY } from './phone-image-store.js';

export const USER_DNA_KEY = '__user__';
const VIEWS = ['full_body', 'half_body', 'portrait'];
const TEXT_LIMIT = 4096;

const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value.trim() : '';

/** 角色卡范围键：群聊按群，单聊按卡名，同一张卡的不同聊天共用一份。 */
export function imageScopeKey(ctx) {
    if (!ctx || typeof ctx !== 'object') return '';
    if (ctx.groupId != null && String(ctx.groupId) !== '') return `group:${ctx.groupId}`;
    const card = ctx.characterId != null && Array.isArray(ctx.characters) ? ctx.characters[ctx.characterId] : null;
    const name = text(card?.name) || text(ctx.name2);
    if (name) return `card:${name}`;
    return text(card?.avatar) ? `card:${text(card.avatar)}` : '';
}

// 衣装取手机日历当天的穿搭记录；没有就不写，交给写词按场景决定。
function calendarOutfit(storageId, subject, storyDate) {
    if (!storageId || !storyDate) return null;
    try {
        const day = outfitForDate(outfitScopeFor(loadOutfitStore(), storageId, subject), storyDate);
        return day?.text ? { name: '', description: day.text } : null;
    } catch (error) { return null; }
}

export function createEmptyImageDnaStore() { return { version: 1, scopes: {} }; }

export function normalizeDnaRecord(value) {
    const source = plain(value);
    const views = {};
    for (const view of VIEWS) {
        const subject = text(source.dna?.views?.[view]?.subject).slice(0, TEXT_LIMIT);
        const negative = text(source.dna?.views?.[view]?.negative).slice(0, TEXT_LIMIT);
        if (subject) views[view] = { subject, ...(negative && { negative }) };
    }
    if (!Object.keys(views).length) return null;
    const personality = text(source.dna?.personality).slice(0, 600);
    return {
        dna: { version: 2, views, ...(personality && { personality }) },
        source: source.source === 'manual' ? 'manual' : 'ai',
        updatedAt: Number.isSafeInteger(source.updatedAt) ? source.updatedAt : 0,
    };
}

export function normalizeImageDnaStore(value) {
    const store = createEmptyImageDnaStore();
    for (const [scopeKey, scope] of Object.entries(plain(plain(value).scopes))) {
        const records = {};
        for (const [name, record] of Object.entries(plain(scope))) {
            const normalized = normalizeDnaRecord(record);
            if (normalized && text(name)) records[text(name)] = normalized;
        }
        if (Object.keys(records).length) store.scopes[scopeKey] = records;
    }
    return store;
}

/** 写词回复 → DNA。三景别至少要有一个非空。 */
export function parseDnaResponse(raw) {
    const data = parseFirstJsonObject(raw, '角色形象回复不是JSON');
    const negative = text(data.negative);
    const views = {};
    for (const view of VIEWS) {
        const subject = text(data[view]);
        if (subject) views[view] = { subject, ...(negative && { negative }) };
    }
    const record = normalizeDnaRecord({ dna: { views, personality: data.personality }, source: 'ai', updatedAt: Date.now() });
    if (!record) throw new Error('角色形象回复缺少外貌标签');
    return record;
}

export const DNA_SYSTEM_PROMPT = [
    '你为绘图整理一个角色的固定外貌资料，供之后每张图画出同一个人。只写稳定的身份：性别人数、发型发色、眼睛、脸、肤色、体型和稳定的身体特征；不写衣服、配饰、表情、动作和场景。',
    '- 全部用逗号分隔的英文 Danbooru 标签，不写句子；开头写 1girl、1boy 这类标签。',
    '- 发色和最核心的辨识特征用 1.2::tag:: 加权；准确的同人角色可用 2::Name (Series)::。资料没有的年龄、身高、三围数值不编。',
    '- 三个取景来自同一份母版：full_body 是完整版；half_body 删掉只有腰胯以下才看得到的特征；portrait 只留头颈肩看得到的特征。共同标签逐字相同。',
    '- negative 只写与本人外貌冲突、需要排除的标签，可以为空。personality 用一两句中文写稳定性格，可以为空。',
    '只输出 JSON：{"full_body":"","half_body":"","portrait":"","negative":"","personality":""}',
].join('\n');

export function buildDnaUserPrompt({ name, isUser, cardDesc, cardPersonality, worldBookText, userDesc }) {
    const parts = [`角色：${name}${isUser ? '（用户本人）' : ''}`];
    const desc = isUser ? userDesc : cardDesc;
    if (text(desc)) parts.push(`设定：\n${text(desc).slice(0, 6000)}`);
    if (!isUser && text(cardPersonality)) parts.push(`性格：\n${text(cardPersonality).slice(0, 1500)}`);
    if (text(worldBookText)) parts.push(`世界书摘录（只取与此角色外貌有关的部分）：\n${text(worldBookText).slice(0, 4000)}`);
    if (parts.length === 1) parts.push('没有更多设定，按名字与常见形象设计一份协调的外貌。');
    return parts.join('\n\n');
}

export function createImageDnaService({ callAI, gatherContext, getCtx, getUserPersona,
    readStore = () => pmIDBGet(IMAGE_DNA_STORE_KEY), writeStore = value => pmIDBSet(IMAGE_DNA_STORE_KEY, value) } = {}) {
    let cache = null;
    const inflight = new Map();
    const load = async () => {
        if (!cache) cache = normalizeImageDnaStore(await readStore().catch(() => null));
        return cache;
    };
    const save = async next => {
        const ok = await writeStore(next);
        if (ok === false) throw new Error('角色形象保存失败：IndexedDB不可用');
        cache = next;
    };

    async function list(scopeKey) {
        return Object.entries((await load()).scopes[scopeKey] || {}).map(([name, record]) => ({ name, ...record }));
    }
    async function setRecord(scopeKey, name, record) {
        const store = normalizeImageDnaStore(await load());
        const scope = { ...(store.scopes[scopeKey] || {}) };
        if (record) scope[name] = record; else delete scope[name];
        store.scopes = { ...store.scopes, [scopeKey]: scope };
        if (!Object.keys(scope).length) delete store.scopes[scopeKey];
        await save(store);
    }
    async function saveManual(scopeKey, name, dna) {
        const record = normalizeDnaRecord({ dna, source: 'manual', updatedAt: Date.now() });
        if (!record) throw new Error('至少填写一个取景的外貌标签');
        await setRecord(scopeKey, name, record);
        return record;
    }
    const clear = (scopeKey, name) => setRecord(scopeKey, name, null);

    async function write(scopeKey, name, { isUser = false, signal } = {}) {
        const key = `${scopeKey}\u0001${name}`;
        if (inflight.has(key)) return inflight.get(key);
        const job = (async () => {
            let context = {};
            try {
                context = await gatherContext?.(null, { module: 'chat', signal, worldBookMaxChars: 4000,
                    outfitSubject: isUser ? OUTFIT_SELF_SUBJECT : `role:${name}` }) || {};
            } catch (error) {
                if (error?.name === 'AbortError') throw error;
                // 手机联系人不一定有角色卡；读不到就只凭名字写。
                context = {};
            }
            const persona = getUserPersona?.() || {};
            const raw = await callAI(DNA_SYSTEM_PROMPT, buildDnaUserPrompt({ name, isUser, ...context,
                userDesc: context.userDesc ?? persona.description }), { isolated: true, module: 'image', signal });
            const record = parseDnaResponse(raw);
            await setRecord(scopeKey, name, record);
            return record;
        })().finally(() => inflight.delete(key));
        inflight.set(key, job);
        return job;
    }

    /**
     * 解析一个出图角色：{ characterKey, dna, outfit, source }。
     * source：phone = 手机已存；written = 刚写好；none = 没有 DNA（写失败或不允许写）。
     */
    async function resolve(name, { isUser = false, storageId = '', storyDate = '', allowWrite = true, signal } = {}) {
        const scopeKey = imageScopeKey(getCtx?.());
        const display = text(name) || (isUser ? text(getUserPersona?.()?.name) || '我' : '');
        const outfit = calendarOutfit(storageId, isUser ? OUTFIT_SELF_SUBJECT : `role:${display}`, storyDate);
        const base = { characterKey: display, ...(outfit && { outfit }) };
        const storeName = isUser ? USER_DNA_KEY : display;
        const saved = (await load()).scopes[scopeKey]?.[storeName];
        if (saved) return { ...base, dna: saved.dna, source: 'phone' };
        if (!allowWrite || typeof callAI !== 'function') return { ...base, source: 'none' };
        try {
            const written = await write(scopeKey, storeName, { isUser, signal });
            return { ...base, dna: written.dna, source: 'written' };
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            return { ...base, source: 'none', error: error?.message || String(error) };
        }
    }

    const invalidate = () => { cache = null; };
    return { resolve, list, saveManual, clear, write, invalidate, scopeKey: () => imageScopeKey(getCtx?.()) };
}
