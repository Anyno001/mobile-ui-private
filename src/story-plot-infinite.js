// 剧情助手里无限流项目的动作：进入/返回、世界库、骰池、造世界规范、写法条目前缀、主空间参数。
// 运行时由 story-plot.js 传入；同页有独立版时运行时是独立版的，旧版独立版没有这些方法，统一先判断再调用。
import { DEFAULT_HUB, HUB_WORD_KEYS, POOL_LABELS, findWorld, normalizeInfinite, poolToText, resolveHub, textToPool } from './plot-injector/core/infinite.js';
import { DEFAULT_WORLD_SPEC, worldSpecText } from './plot-injector/core/infinite-world.js';
import { promptText } from './story-plot-io.js';

const lines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);

export function createInfiniteActions(deps, { api, viewed, updateViewed, runtimeForViewed, toast, rerender, confirmAction }) {
    let openWorldId = '';

    const supported = runtime => Boolean(runtime && typeof runtime.infState === 'function');
    const save = fn => updateViewed(current => ({ ...current, infinite: fn(normalizeInfinite(current.infinite)) }));
    const config = () => normalizeInfinite(viewed()?.infinite).config;
    const hubName = () => resolveHub(config()).hubName;

    function runtimeOrWarn() {
        const runtime = runtimeForViewed();
        if (!runtime) { toast('info', '先把这个项目设为当前聊天使用。'); return null; }
        if (!supported(runtime)) { toast('warning', '独立版剧情注入器版本较旧，不支持无限流。'); return null; }
        return runtime;
    }

    // 视图模型里无限流相关的字段。
    function viewFields(vm) {
        const project = vm.viewed;
        if (!project || project.mode !== 'infinite') return { infinite: false };
        const runtime = project.id === vm.activeId ? api()?.runtime : null;
        const ok = supported(runtime);
        return {
            infinite: true,
            infConfig: normalizeInfinite(project.infinite),
            infState: ok ? runtime.infState() : null,
            infRead: ok ? runtime.lastRead() : null,
            infOpening: ok ? Boolean(runtime.isOpening()) : false,
            infOpenWorld: openWorldId,
        };
    }

    const actions = {
        'inf-enter': () => { const runtime = runtimeOrWarn(); if (!runtime) return null; const job = runtime.openWorld(); rerender(); return Promise.resolve(job).finally(rerender); },
        'inf-return': () => {
            const runtime = runtimeOrWarn();
            if (!runtime) return;
            const name = hubName();
            if (!confirmAction(`回到${name}？会撤掉当前世界档案的注入，档案留在世界库里。`)) return;
            runtime.returnToTrain();
            rerender();
        },
        'world-open': button => { openWorldId = openWorldId === button.dataset.plotId ? '' : button.dataset.plotId; rerender(); },
        'world-reopen': button => { const runtime = runtimeOrWarn(); if (!runtime) return; runtime.reopenWorld(button.dataset.plotId); rerender(); },
        'world-del': button => {
            const runtime = runtimeOrWarn();
            if (!runtime) return;
            const world = findWorld(runtime.infState()?.inf.worlds || [], button.dataset.plotId);
            if (!world || !confirmAction(`删除「${world.title}」？档案删除后不能恢复。`)) return;
            runtime.deleteWorld(world.id);
            if (openWorldId === world.id) openWorldId = '';
            rerender();
        },
        'pool-edit': async button => {
            const key = button.dataset.plotField;
            const infinite = normalizeInfinite(viewed()?.infinite);
            if (!infinite.pools[key]) return;
            const text = await promptText(deps, { title: POOL_LABELS[key], label: '每行「名称|权重」', value: poolToText(infinite.pools[key]), multiline: true, rows: 10 });
            if (text == null) return;
            const rows = textToPool(text);
            save(current => ({ ...current, pools: { ...current.pools, [key]: rows } }));
            rerender();
        },
        'spec-edit': async () => {
            const text = await promptText(deps, { title: '造世界规范', label: '留空或与默认相同时使用默认规范', value: worldSpecText(normalizeInfinite(viewed()?.infinite)), multiline: true, rows: 16 });
            if (text == null) return;
            const value = String(text).trim() === DEFAULT_WORLD_SPEC.trim() ? '' : String(text);
            save(current => ({ ...current, spec: value }));
            rerender();
        },
        'spec-reset': () => {
            if (!confirmAction('恢复默认的造世界规范？')) return;
            save(current => ({ ...current, spec: '' }));
            rerender();
        },
        'prefix-edit': async () => {
            const value = await promptText(deps, { title: '条目标题前缀', label: '条目标题 = 前缀 + 恐怖类型', value: config().horrorPrefix });
            if (value == null) return;
            save(current => ({ ...current, config: { ...current.config, horrorPrefix: String(value) } }));
            rerender();
        },
        'hub-edit': async button => {
            const field = button.dataset.plotField;
            const cfg = config();
            const isWord = HUB_WORD_KEYS.includes(field);
            const list = field === 'fieldNames' || isWord;
            const current = isWord ? cfg.words[field] : cfg[field];
            const titles = { hubName: '主空间名称', blockTag: '状态块标签', fieldNames: '栏名' };
            const wordTitles = { back: `返回${cfg.hubName}`, depart: '出发', away: '在副本里', hub: `在${cfg.hubName}` };
            const title = isWord ? wordTitles[field] : titles[field];
            if (!title) return;
            const text = await promptText(deps, {
                title, label: list ? '一行一个词，靠前的优先匹配，第一个词用作显示名；清空则按默认词读取' : title,
                value: list ? current.join('\n') : current, multiline: list, rows: 8,
            });
            if (text == null) return;
            if (isWord) save(item => ({ ...item, config: { ...item.config, words: { ...item.config.words, [field]: lines(text) } } }));
            else if (field === 'fieldNames') save(item => ({ ...item, config: { ...item.config, fieldNames: lines(text) } }));
            else save(item => ({ ...item, config: { ...item.config, [field]: String(text).trim() } }));
            rerender();
        },
        'hub-reset': () => {
            if (!confirmAction('恢复主空间的名称、标签、栏名和四组词为默认？')) return;
            save(current => ({ ...current, config: { ...current.config, hubName: DEFAULT_HUB.hubName, blockTag: DEFAULT_HUB.blockTag, fieldNames: [...DEFAULT_HUB.fieldNames], words: Object.fromEntries(HUB_WORD_KEYS.map(key => [key, [...DEFAULT_HUB.words[key]]])) } }));
            rerender();
        },
    };

    return { actions, viewFields, reset: () => { openWorldId = ''; } };
}
