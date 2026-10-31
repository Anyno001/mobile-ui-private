import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 剧情注入器核心（src/plot-injector/core/）逐字拷自 PlotInjector src/core/，只在 PlotInjector 改。这里比对哈希：不一致就失败。
// PlotInjector 改了核心后：用 git show <tag>:src/core/<名> 重新拷过来（保持 LF），用本脚本打印的实际哈希更新下表（node scripts/check-plot-core.mjs --print）。
// 当前对应 PlotInjector 版本：v0.1.15。
const EXPECTED = Object.freeze({
    'acu.js': '6d8226b018cd5d6e535875c0b2ebe7ef82e6ee40928b7fe779e0da860b3ca062',
    'check.js': '3192bc30afbca837eaf43f84ef4bf187eab3ed7701959412d2501641ba566206',
    'guide.js': '753940ac1ca25ec3b3f3b3ade8460427aac5db0ceec831601e595050b6901588',
    'inject.js': '1536995b593fc260234a4b29dd82b09d895c1878d99ea44da53ecb677d841200',
    'outline.js': '072f91810e5c6e42e2bfeaee3e429d2a1324e66f9f431a1c4142327122ef8ed6',
    'progress.js': '17b362e3842de422a6b1defb5483be50e758e88cee375fb6116fcc168f643896',
    'prompts.js': '61a8891cf5ba14453fff2b7cfe952abb749b02275d47e5905723113581a6a4da',
    'refs.js': '0a21c44246e206612ddc8e0d780710e13443fb80135ef0c36bdfb91539cc5304',
    'setting.js': '762940cf43bdf4ed84248955a05f7d06a798aea1a8d3fafb5e8036a6006e4c64',
    'store.js': '532c678f4ccce6668e0daddca2b2eb373304495f9465200958da6e6b7859ec0a',
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
