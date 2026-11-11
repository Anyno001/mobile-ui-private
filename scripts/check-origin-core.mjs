import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 金手指核心（src/origin/）逐字拷自 IGS app/src/scene/origin/，只在 IGS 改。这里比对哈希：不一致就失败。
// IGS 那边改了核心后：把核心文件重新拷过来，用本脚本打印的实际哈希更新下表（node scripts/check-origin-core.mjs --print）。
// 当前对应 IGS 版本：v0.40.3。
const EXPECTED = Object.freeze({
    'origin-apply.js': '7ba4cf1af6f5a8bf21af34ac97fae00cc1ba14c904c59beac556296a18578350',
    'origin-economy-schema.js': '22564523c3198f9c33ba1234b6b01ade1b16d8f37f5760e2155b03bb175b2fc1',
    'origin-economy.js': 'e114d04e28d0ca0d407407d13de33df312822cd43ff45e9c3393c83f7d3df0a3',
    'origin-engine.js': '90a9838fdfc232ad0b3990aff90eedf7a5e7fd90574f359bbba410fa74fb576c',
    'origin-gen.js': '2644a6377dece5e3e53d4c807ea664d50dcc2eeef5fffaac809c9addfc531800',
    'origin-inject.js': 'b0c68d9e09fddf87a25b2213304eb298802c8540c151aabd9aa477beac6e2b46',
    'origin-ledger.js': '525327867694981a52a0aea338fe9cf7de0caa861adcb1c756b4a8b2c17052aa',
    'origin-log.js': '42eb8dd7d20d3baa476ad40a0edaabe2273eaeff7b87327e91c1cb1f40a678fd',
    'origin-parse.js': '7522c1165ac7a9cbb657c2608f42c02b06c898d561ce85793d16012b2e31be7a',
    'origin-prose.js': 'e2828145a12ae96097f47c5a370a4378f32ee7d7e89157c7cefdc16b76dae0f6',
    'origin-state.js': '7bde31b1f02f16a39eaaa4ff3a9f2eb729b51e2f74e6f85666466f8f94e2c076',
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
