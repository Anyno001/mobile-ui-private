import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 剧情注入器核心（src/plot-injector/core/）逐字拷自 PlotInjector src/core/，只在 PlotInjector 改。这里比对哈希：不一致就失败。
// PlotInjector 改了核心后：用 git show <tag>:src/core/<名> 重新拷过来（保持 LF），用本脚本打印的实际哈希更新下表（node scripts/check-plot-core.mjs --print）。
// 当前对应 PlotInjector 版本：v0.1.19。
const EXPECTED = Object.freeze({
    'acu.js': '6d8226b018cd5d6e535875c0b2ebe7ef82e6ee40928b7fe779e0da860b3ca062',
    'check.js': '3192bc30afbca837eaf43f84ef4bf187eab3ed7701959412d2501641ba566206',
    'guide.js': '753940ac1ca25ec3b3f3b3ade8460427aac5db0ceec831601e595050b6901588',
    'infinite-flow.js': 'ae058fb1f6ce2bedc67fa717e1c4a771f441b32729134d6180e7d1e9f1bb0bed',
    'infinite-state.js': '8d3017c8ab9deb5c2213a983ac8df6d0239df2c045cde6b279de54cc10ef5bb1',
    'infinite-world.js': '8b46fb88637f66afd3186ea4de4538452c5405bdee017910155d97eef6db0b14',
    'infinite.js': 'd1a0f04b7de4e0c6d954a48b8fe03dc79748fd654dbcc2a8b4b4be22d8665767',
    'inject.js': '5924e4e50bf54ce2266631678a35720ce34e8dfe71d30bbfe66b4aaf1fb62485',
    'outline.js': '072f91810e5c6e42e2bfeaee3e429d2a1324e66f9f431a1c4142327122ef8ed6',
    'progress.js': '53feeaeca8b09979e35c4768b36e1eeac787421a53301a96b3c0526cd12024f4',
    'prompts.js': '61a8891cf5ba14453fff2b7cfe952abb749b02275d47e5905723113581a6a4da',
    'refs.js': '0a21c44246e206612ddc8e0d780710e13443fb80135ef0c36bdfb91539cc5304',
    'setting.js': '762940cf43bdf4ed84248955a05f7d06a798aea1a8d3fafb5e8036a6006e4c64',
    'store.js': '02ef14447134165993158254968e46e4a2fcd65705d03d288521007168843c3b',
    'tokens.js': 'fb31ccc09d095748215a23975eaf4160812d2792989796ce3ab0495c057a1ca9',
    'wbtools.js': '9e8c8fed174acd71d10ab865d80d7e308fe4e287417dcd75637a74bf5df877a6',
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
console.log(`Plot injector core checks passed (${files.length} files match PlotInjector).`);
