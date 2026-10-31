import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 金手指核心（src/origin/）逐字拷自 IGS app/src/scene/origin/，只在 IGS 改。这里比对哈希：不一致就失败。
// IGS 那边改了核心后：把 8 个文件重新拷过来，用本脚本打印的实际哈希更新下表（node scripts/check-origin-core.mjs --print）。
// 当前对应 IGS 版本：v0.37.58 前的工作区副本（推送后若有改动需重拷）。
const EXPECTED = Object.freeze({
    'origin-apply.js': '3532a773f1bfa718927961d88bf1a40a48535a0684a4cc1ec25313dbe0f0d7a3',
    'origin-engine.js': '58eed4342c796d7f7ee95c6bf2efb9c3aa18843c92147d2fb953cf0ec7e0dd49',
    'origin-gen.js': 'efa34cdb7f5c756580ed6805676529a44ddc8fc5e9da716e57360514b3fc5bed',
    'origin-inject.js': '050a171f7f349ba8b0989c483dbd2c427c2fa0ba5ad4aad26fbd48ccdf918b29',
    'origin-ledger.js': 'a0db2f6333bf1d166988de2248793a19281d0d9d2473352ebc1f4832f4faafa6',
    'origin-parse.js': '2adb311cbc499cfd954bce7c08d3d13709b3cff6a2912acb679d9b7ee20fdd61',
    'origin-prose.js': 'fabc61d69b35f0f64d28cfddd6a90a3d4a414705cba415ba3f3d8b8734788bed',
    'origin-state.js': 'ba7ff011bcb18c706f16c80079072ec9eb1dd2d89f79483c240f53ab81af769e',
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
