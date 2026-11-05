import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 金手指核心（src/origin/）逐字拷自 IGS app/src/scene/origin/，只在 IGS 改。这里比对哈希：不一致就失败。
// IGS 那边改了核心后：把 8 个文件重新拷过来，用本脚本打印的实际哈希更新下表（node scripts/check-origin-core.mjs --print）。
// 当前对应 IGS 版本：v0.39.33（dd75c529）。
const EXPECTED = Object.freeze({
    'origin-apply.js': '9488a0706cbdf4dde8f46d0e50aba3233764ea155ea4e9f3a6dfec5dadc770d9',
    'origin-engine.js': 'd3e76580582158c2e6154e7cd632b4c5addd70677b900374c52d3139f4e5bbf2',
    'origin-gen.js': '40c4f0c9e7465bcf60ccaaf3f56a796471921594c9fee1260db622b866b0ed7b',
    'origin-inject.js': 'd1899a15b8b26ff04318b3209ee33dfb79275dc16ef1c6acf8816a9995f1ae07',
    'origin-ledger.js': '5a2de190b788c45ddb2a77b4ec97388f03d4787be2ab29eed5485e50e5fd7176',
    'origin-parse.js': '2adb311cbc499cfd954bce7c08d3d13709b3cff6a2912acb679d9b7ee20fdd61',
    'origin-prose.js': '73ef235f46eab9501928ac8f40dd3233f650745dc23c36f40b5ccb8d1f9764b2',
    'origin-state.js': '8d5998c3324bba09c3f0320e5bb18656c3542de3b5f561bc94c311cc8a74d536',
});

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'origin');
const files = (await readdir(dir)).filter(name => name.endsWith('.js')).sort();
const actual = Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await readFile(path.join(dir, name))).digest('hex')])));

if (process.argv.includes('--print')) {
    for (const [name, hash] of Object.entries(actual)) console.log(`    '${name}': '${hash}',`);
    process.exit(0);
}

const failures = [];
for (const name of Object.keys(EXPECTED)) {
    if (!actual[name]) failures.push(`缺少核心文件 src/origin/${name}`);
    else if (actual[name] !== EXPECTED[name]) failures.push(`src/origin/${name} 与 IGS 版本不一致：核心只在 IGS 改，改完重拷并更新哈希`);
}
for (const name of files) if (!EXPECTED[name]) failures.push(`src/origin/${name} 不在核心清单里：核心目录只放从 IGS 拷来的文件`);
if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
}
console.log(`Origin core checks passed (${files.length} files match IGS).`);
