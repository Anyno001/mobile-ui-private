import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 剧情注入器核心（src/plot-injector/core/）逐字拷自 PlotInjector src/core/，只在 PlotInjector 改。这里比对哈希：不一致就失败。
// PlotInjector 改了核心后：用 git show <tag>:src/core/<名> 重新拷过来（保持 LF），用本脚本打印的实际哈希更新下表（node scripts/check-plot-core.mjs --print）。
// 当前对应 PlotInjector 版本：v0.1.24。
const EXPECTED = Object.freeze({
    'acu.js': '6d8226b018cd5d6e535875c0b2ebe7ef82e6ee40928b7fe779e0da860b3ca062',
    'align.js': '36f49a2959018c555ce4cd52aa98e78b2f0687bd0e64ce11bf10d4336f8bddac',
    'check.js': '3ab3511bc1dec657787fac0fae7bf7714eaa66678665540f3b45fea9b7dc0e01',
    'guide.js': '0024964e7cd2d345431c3079b8be9ece77c4d56dd54be308d5d132000cf7567e',
    'infinite-flow.js': 'ae058fb1f6ce2bedc67fa717e1c4a771f441b32729134d6180e7d1e9f1bb0bed',
    'infinite-state.js': '8d3017c8ab9deb5c2213a983ac8df6d0239df2c045cde6b279de54cc10ef5bb1',
    'infinite-world.js': '8b46fb88637f66afd3186ea4de4538452c5405bdee017910155d97eef6db0b14',
    'infinite.js': 'd1a0f04b7de4e0c6d954a48b8fe03dc79748fd654dbcc2a8b4b4be22d8665767',
    'inject.js': '20baed895f1870c3e65bc3d8be6d67df15500a9f1f49ad68a910ce4b843cd19e',
    'outline.js': '2b9b572307c9ba192528703476e14035b49b3ca0b2b7660a9450f98ea07b9cd7',
    'progress.js': '1bfde575be487af1cd2d097ea85bf22b553001c79839179fbd0cd8b592da9eb4',
    'prompts.js': 'a4e536cfbdb8ce2958aa3b49da9e0a76a132cf4200fdba0aa00a93b587eef253',
    'refs.js': '0a21c44246e206612ddc8e0d780710e13443fb80135ef0c36bdfb91539cc5304',
    'setting.js': '554508b7644c2cdc5fb1ddcdae6346c0a0ca9838265798ea557f0ad8eb4588ca',
    'store.js': '3148b38f19dde02f21560a92388350e6250f70e1c641ddd979397eeed0c663f9',
    'threads.js': 'c29a9036a0e9f823d5f104b70c7599e728e15125943a417563a54237104ae130',
    'tokens.js': 'fb31ccc09d095748215a23975eaf4160812d2792989796ce3ab0495c057a1ca9',
    'wbtools.js': '7acd1b561ab45f01226a6767d236527451cbae542f5fd056fcb81cef1f3898cd',
    'yaml.js': '4b9cd5ae95190a0b8550f0c09d17788e80d29721ea2508fa7291f53a35d8433d',
    'zip.js': '8b36c3ea3df6596354ea19880034417b80693d9535278512e664a567b56182b6',
});

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'plot-injector', 'core');
const files = (await readdir(dir)).filter(name => name.endsWith('.js')).sort();
const actual = Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await readFile(path.join(dir, name))).digest('hex')])));

if (process.argv.includes('--print')) {
    for (const [name, hash] of Object.entries(actual)) console.log(`    '${name}': '${hash}',`);
    process.exit(0);
}

const failures = [];
for (const name of Object.keys(EXPECTED)) {
    if (!actual[name]) failures.push(`缺少核心文件 src/plot-injector/core/${name}`);
    else if (actual[name] !== EXPECTED[name]) failures.push(`src/plot-injector/core/${name} 与 PlotInjector 版本不一致：核心只在 PlotInjector 改，改完重拷并更新哈希`);
}
for (const name of files) if (!EXPECTED[name]) failures.push(`src/plot-injector/core/${name} 不在核心清单里：核心目录只放从 PlotInjector 拷来的文件`);
if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
}

// 旧数据兼容：旧大纲与旧进度在新核心上的注入、索引、检测提示与 v0.1.20 核心逐字一致（快照见 plot-legacy-snapshot.json）；
// 旧项目文件、旧进度、旧设置读入不抛错，新字段补上默认值。
const scripts = path.dirname(fileURLToPath(import.meta.url));
const { legacyFiles, legacyOutputs } = await import('./plot-legacy-scenarios.mjs');
const snapshot = JSON.parse(await readFile(path.join(scripts, 'plot-legacy-snapshot.json'), 'utf8'));
const outputs = await legacyOutputs(dir);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
for (const key of Object.keys(snapshot)) {
    if (!outputs[key]) failures.push(`旧数据场景 ${key} 没有输出`);
    else if (key === 'fresh' ? JSON.stringify(outputs[key]) !== JSON.stringify(snapshot[key]) : digest(outputs[key]) !== snapshot[key]) failures.push(`旧数据场景 ${key} 的注入、索引或检测提示与 v0.1.20 不一致`);
}
const core = name => import(pathToFileURL(path.join(dir, name)).href);
const { normalizeProject, normalizeSettings } = await core('store.js');
const { normalizeProgress, offNodes, unitStates, checkBase } = await core('progress.js');
const { flattenUnits, volumesFromValue } = await core('outline.js');
const { alignProgress, outlineLinks } = await core('align.js');
const { buildEntries } = await core('inject.js');
const { liveThreads, threadSwitches, maskUnits, clampThreads } = await core('threads.js');
const volumes = volumesFromValue((await import('./plot-legacy-scenarios.mjs')).LEGACY_OUTLINE);
const old = legacyFiles(volumes);
try {
    const project = normalizeProject(old.project, 'p1');
    const progress = normalizeProgress(old.progress, 'p1');
    const units = flattenUnits(project.outline.volumes);
    const expect = (ok, text) => { if (!ok) failures.push(text); };
    expect(Array.isArray(project.outline.history) && !project.outline.history.length, '旧项目读入后 outline.history 应为空数组');
    expect(project.threads.sideOn === true && project.threads.worldOn === true, '旧项目读入后支线、世界动态开关默认开');
    expect(!('lastFailFloor' in progress) && checkBase(progress) === 4, '旧进度没有 lastFailFloor，检测起点仍按 lastCheckFloor');
    // 归位会给只记位置的旧标记补上节点名（offNames），已演节点与注入内容不变。
    const aligned = alignProgress(progress, project.outline);
    expect(offNodes(aligned, units[0], outlineLinks(project.outline)).join() === 'm0,s1', '旧进度归位后已演节点不变');
    expect(JSON.stringify(buildEntries(project, aligned, normalizeSettings({}))) === JSON.stringify(buildEntries(project, progress, normalizeSettings({}))), '旧进度归位前后注入内容一致');
    expect(alignProgress(aligned, project.outline) === aligned, '归位过的进度再归位应原样返回');
    expect(offNodes(progress, units[0], outlineLinks(project.outline)).join() === 'm0,s1', '旧进度只记位置的已演节点照旧读出');
    expect(maskUnits(units, threadSwitches(project)) === units, '开关全开时 maskUnits 原样返回');
    expect(clampThreads(progress, 10) === progress, '旧进度没有钟与钩子，夹楼数应原样返回');
    const live = liveThreads(units, unitStates(units, progress), progress);
    expect(live && typeof live === 'object', 'liveThreads 在旧数据上应返回对象');
    const settings = normalizeSettings({ checkEvery: 5 });
    expect(settings.hookCap === 2 && settings.newThreadMode === 'ask' && settings.persona === '', '旧设置读入后补上 hookCap、newThreadMode、persona');
} catch (error) {
    failures.push(`旧数据读入抛错：${error.message}`);
}
if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
}
console.log(`Plot injector core checks passed (${files.length} files match PlotInjector, ${Object.keys(snapshot).length} legacy scenarios unchanged).`);
