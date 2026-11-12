import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 金手指核心（src/origin/）逐字拷自 IGS app/src/scene/origin/，只在 IGS 改。这里比对哈希：不一致就失败。
// IGS 那边改了核心后：把核心文件重新拷过来，用本脚本打印的实际哈希更新下表（node scripts/check-origin-core.mjs --print）。
// 当前对应 IGS 版本：v0.40.10。
const EXPECTED = Object.freeze({
    'origin-apply.js': '2bd8fee602e348185f12b192d7dcd73e8564632b44a2f5443d982cba31323073',
    'origin-economy-schema.js': '22564523c3198f9c33ba1234b6b01ade1b16d8f37f5760e2155b03bb175b2fc1',
    'origin-economy.js': 'e114d04e28d0ca0d407407d13de33df312822cd43ff45e9c3393c83f7d3df0a3',
    'origin-engine.js': '761650caf055db3c15af6fc9c7d1c482c156f27f66198e30343b3009313bb09d',
    'origin-gen.js': '1b9c8a05f8cc8b2f1ca9e99631bcb5ea23ac7c5ffcaf0765cff988cc8c3f2ed5',
    'origin-inject.js': 'c341490c2e53e8ab579dd82214dde81ceae169fd07af7de7d05196e03bf4a618',
    'origin-ledger.js': 'fb9f4d29b5e777ecbbdae194a917c8e8c86fdddd5b4150e05f672ed90c61b699',
    'origin-log.js': '42eb8dd7d20d3baa476ad40a0edaabe2273eaeff7b87327e91c1cb1f40a678fd',
    'origin-parse.js': '9150c97d23e36f2a579dc0d300e53663db2b71d46563875b4509456cbd095cf7',
    'origin-prose.js': '88bd8a8d7cf18eaa1649b31efb9620d2ef92bc908925ad08301ec1db29030152',
    'origin-state.js': '17b37d38045fcf1a0f058c5e47d969c37222bf8f2d9d9ed722a36e982c8c8487',
});

// 核心依赖的 IGS 积分策略模块（src/points/points-policy.js），同样逐字拷自 IGS app/src/scene/points/，只校验哈希。
const POLICY_HASH = 'db58bbd833d46310d4019f132bfd800bdc876ce89b89aabfd08742023803ca66';
const policyFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'points', 'points-policy.js');

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'origin');
const files = (await readdir(dir)).filter(name => name.endsWith('.js')).sort();
const actual = Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await readFile(path.join(dir, name))).digest('hex')])));

if (process.argv.includes('--print')) {
    for (const [name, hash] of Object.entries(actual)) console.log(`    '${name}': '${hash}',`);
    process.exit(0);
}

const failures = [];
const policyHash = createHash('sha256').update(await readFile(policyFile)).digest('hex');
if (policyHash !== POLICY_HASH) failures.push('src/points/points-policy.js 与 IGS 版本不一致：只在 IGS 改，改完重拷并更新哈希');
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
