# 上游合并现状与方式说明

> 助手，本记录只核实现状，不继续解决合并，不授权提交。
> taskId：merge-progress-documentation；sliceId：核实合并现状并生成说明文档。
> 快照：2026-09-11 00:01–00:04 +08:00；源码行号对应当时工作树。
> 第 1–7 节为历史快照，不代表后续标题裁决；当前标题状态与本轮验证见第 8 节。

## 1. 边界与依据

完整读取根 `merge-commit-msg.txt:1–24`，将其视为工作要求而非完成证明。读取根 AGENTS.md → CLAUDE.md 及其八份引用规则、内层 AGENTS.md。本次只新增本文，不改源码、脚本、构建配置、索引、引用、提交消息及既有计划。

外层仓库为 `D:/酒馆项目/tavern_helper_template`；内层为其 `public/mobile-ui-private`，有独立 `.git`，在外层显示为未跟踪目录，不是本次应更新的子模块指针。外层原有 6 个未暂存修改、14 项未跟踪；不归本任务处置。

契约发现：递归列出根 `.limcode` 并检索 durable、task/report contract、implementationId、basedOnReportId、taskId，仅发现无关历史计划的标识；内层磁盘 `.limcode` 为空，但索引存在 30 个新增文档，在工作树均删除（AD）。补充 `git grep --cached` 检索这些契约标识，无命中（退出码 1 表示未找到）。在已检查范围未发现 durable task/report contract，不创建自定义状态文件，不改历史进度。内层 docs 未发现同用途合并文档。

## 2. Git 进度：未提交合并，不等于尚有文本冲突

| 锚点 | 值 |
| --- | --- |
| HEAD / ORIG_HEAD | `fef9261476778b5c5340c6d07b9136255d99b68d` |
| MERGE_HEAD | `c25cba2d9fbe85e60447269a7b40ce6443d367b1` |
| 本地 upstream/main | `016340d293a9f347930770b1e284ca0a3b41c482` |
| merge-base HEAD MERGE_HEAD | `59737808b2a7f2538cf638ea54e14429ee53bd9f` |

- `git rev-list --count HEAD..MERGE_HEAD` = **72**；`HEAD...MERGE_HEAD` 左右分歧 **41 / 72**。以本地 HEAD 为基准，没有用 origin 偷换。
- `MERGE_HEAD...upstream/main` = **0 / 1**：当前合并目标比本地 upstream/main 少一个提交（后者标题为 `chore: ignore local limcode artifacts`）。未 fetch，不能声称已覆盖远端实时最新状态。
- `git ls-files -u` 无输出：实时未解决索引为 **0**。MERGE_HEAD 仍存在，因此合并尚未形成提交；MERGE_MSG 曾列 16 个冲突只是历史记录，不能解释为仍有 16 个冲突。
- 暂存 118 文件：59 修改、59 新增（其中 30 个 AD）。范围为 `.gitignore`、`.limcode`、docs、scripts、src、styles、wenfengyouhua-skills-v2；统计 18227 增行、718 删行。
- 未暂存：30 个 `.limcode` 文件删除及 `index.js` 修改；文档写入前内层未跟踪文件为 0。AD 表示索引仍准备加入这些文档，磁盘删除不等于排除提交。本文不处置此状态。
- COMMIT_EDITMSG 不是未提交改动清单，也不需要替换。

## 3. 需求与语义证据矩阵

“已证实”限于列出的静态事实或已运行检查，不等于浏览与生产数据验收。以下路径均相对内层仓库。

| 要求 | 结论与证据 | 限制 |
| --- | --- | --- |
| APP 总设置本地保留项 | 部分：`src/today-trend-settings-view.js:30–45` 有溯及既往、归档保留及默认 2 事件/20 楼 | 未逐段对比第一父版本与全部保存调用链 |
| 外部事件收起/展开本地状态 | 未核实本地等价性：`src/today-trend-dynamics-view.js:82–91` 有 menuOpenId、事件渲染入口 | 不能以存在菜单状态替代外部事件状态持久化验收 |
| 标题及 aria，其余 UI 采上游 | 标题/aria 已证实：`src/today-trend-view.js:95` 同时保留 h2 与 aria-labelledby；`scripts/check-today-trend.mjs:841` 为 assert.match | 其余 UI 未全面与上游逐项对照，未浏览器验收 |
| 增量协议、标题命名、generation_mode | 共存已证实：`src/prompts/today-trend/envelopes.js:45–70` 含五键增量协议、标题 guide 与 generation_mode；初始化入口另见 :25、31 | 提示词存在不等于真实模型输出稳定性 |
| check-today-trend 修订 | 已证实标题 match :841、自动调用文案 :926，整项检查退出 0 | 未逐个追溯所有断言的合并历史 |
| schema17 / v16 缺省 / v17 严格 | 已证实：`src/settings-backup-controller.js:30` 导出17；`src/settings-backup-validate.js:372–385` 缺 todayTrendV2 为 null、缺 User 为空库、17 缺 desktopIcons 抛错 | 严格要求是 desktopIcons；当前17缺前两字段仍兼容，不应描述为所有字段严格 |
| 三项状态导出、插件键并集 | 已证实并存：`src/settings-backup.js:163–166` 捕获，`src/settings-backup-controller.js:42–43` 导出；`src/storage.js:53–55` 同时含 today-trend 两回退键及 story-oracle/User 回退键 | 不将“三态”误说成每个字段都允许任意 null/缺省 |
| 两阶段注入、pending 回退、storyOraclePlans | 已证实结构：`src/phone-injection-controller.js:16–70` collect/prepare/apply 分离，:48 回退 pending→store，:33、49 接入启用的 plans；`src/phone-foundation.js:144、251` 暴露 prepare，`src/today-trend.js:24–25` 消费 | 本次未独立模拟生产宿主并发切换 |
| commitTodayTrend 公共签名与屏障 | 当前签名已证实：`src/today-trend.js:377–378` scope(storageId,mutate,task,options)、store(mutate,task,options)；`src/branch-scope-inheritance.js:566–571、659–669` 等待目录操作后加载，保留提交器依赖；调用方 `src/phone-host-events.js:103–104`、`src/diagnostic.js:145–146` | 未独立比较全部历史版本 ABI；不能据此保证每种宿主事件时序 |
| User/desktopIcons 失败 partialApplied | 静态传播已证实：`src/settings-backup.js:229–264` User 保存和图标替换共用 catch，合并 todayTrendReceipt 并重抛；lineage catch 同构；:117–118 消费 partialApplied | 未单独新增针对两个失败点的故障注入测试，不能将通用检查通过写成该场景全覆盖 |

## 4. 合并方式及 index.js 风险

共同祖先存在且两侧分别有 41/72 个独有提交，要求又同时保护本地增量/提交事务契约并接入上游标题、图标、User、story-oracle。因此正确策略是以共同祖先、第一父本地 HEAD、MERGE_HEAD 做三方逐块裁决，而不是整树 ours/theirs。整树 ours 会丢上游能力，整树 theirs 会覆盖本地持久化与增量约束；默认自动合并无冲突也仍须做语义验收。现有双来源实现与待提交索引支持“选择性整合”的判断，但未取得当初命令记录，不声称确知执行过哪种 merge 参数。

建议裁决单位：UI 按根要求保留三个本地例外与标题/aria，其余逐项对照上游；协议取互补并集；持久化先兼容历史格式，再明确拒绝条件；事务链保留统一提交器、屏障及失败回执。以上是说明与后续策略，本次没有重新 merge 或解决任何冲突。

`index.js` 当前为 stage 0，索引 blob 与 `HEAD:index.js` 均为 `1e41f7a78dad9ec5dafa21573d2d2b972ad6ad1c`。`git diff --cached --numstat -- index.js` 为空；工作树相对索引为 554 增行、28597 删行（换行/压缩会显著影响行数）。所以当前确实相对第一父没有暂存该文件改动，而工作树有既存重建差异。

“不入本提交”应定义为未来提交树的 index.js 与第一父一致；不是“不再 add”即可保证，更不表示从项目删除此文件。Git 自动合并或既有暂存均可能提前将文件放入提交，本次用 blob 相等和 cached diff 核对。`package.json:8` 的 build 会写 index.js，本次禁止运行；:9 的语法检查仅解析现有工作树文件。保留旧第一父产物会使未来源码提交与产物不同步，需要明确发布产物的独立流程；这是后续决策，不是本次授权。

## 5. 实际验证与限制

工作目录 `public/mobile-ui-private`，PowerShell 顺序运行，每步立即打印 `$LASTEXITCODE`，不能用最终 shell 退出 0 替代子命令结果。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `node scripts/check-today-trend.mjs` | 0 | Today trend contracts verified；含 IDB unavailable、journal 清理故障日志 |
| `node scripts/check-behavior.mjs` | 0 | Behavior configuration verified；含自动消息、IDB、分支失败日志，不是“无警告” |
| `node scripts/check-contracts.mjs` | 0 | Static contracts verified；bundle observation 1528431 bytes，phase 0 delta 151216 |
| `node --check index.js` | 0 | 现有产物语法通过，不等价于重建或运行成功 |
| `git diff --check` | 0 | 未暂存空白检查通过；另有 LF→CRLF 提醒 |
| `git diff --cached --check` | 0 | 暂存空白检查通过 |

契约检查虽导入 esbuild，但 `scripts/check-contracts.mjs:66–77` 明确 `write:false`，是内存构建；其中 git 调用为只读检查。未安装依赖，未执行 npm run check/build。版本兼容断言定位 `scripts/check-behavior.mjs:5558–5569`，覆盖 v16 User 缺省、v17 图标缺失拒绝与往返。

检查输出经尾部截取，本文不是全量日志归档。未运行浏览器交互/无障碍/移动端与亮暗主题验收、真实宿主存储恢复、全量 package 检查及真实模型调用。遇到文件读取上下文预算拒绝后，依工具指引改为窄行号读取，没有转用终端读取源码；不足部分在矩阵明确标记。

## 6. 剩余工作（未执行，需另行安排）

1. 核验三个本地 UI 例外与第一父等价性，尤其外部事件收起/展开；逐项确认其余 UI 的上游来源。
2. 明确 `.limcode` 的 AD 状态是否符合预期，以及本地 upstream/main 多出的一个提交是否属于下一次合并范围。不要把磁盘删除当作索引已排除。
3. 对 User/desktopIcons 两个失败点补独立回执/回滚验收，并验证分支屏障、并发切换及真实宿主存储场景。
4. 明确源码与 index.js 的发布边界后再评估提交；本次不授权 add、commit、push 或调整索引。
5. Git 冲突索引清空与语义验收分开：当前可以报告“未解决索引为0、合并待提交、定向检查通过”，不能报告“全部合并要求生产验收完成”。

## 7. 本次变更边界

本文是唯一写入目标，未触碰既有 118 项暂存和 31 项未暂存文件。回读校正了 upstream/main 提交标题。回退仅涉及撤回本文的新增内容，不应 reset/checkout 合并工作区，也不应恢复或删除其他既有变更；本次未执行回退。
变更前后内层 cached diff、内层工作树 diff、外层 diff 的只读管道摘要分别保持 `8a7b55b0bbfa90012fd5379669f9777c0369322f`、`c2b0bc4420acd6a182c10e44a671b97a3ec47387`、`255c7080c83c76448e38f8deb7078ae23fb09051`；引用锚点不变，唯一新增未跟踪路径为本文。文档专用 `git diff --no-index --check -- /dev/null docs/UPSTREAM-MERGE-STATUS.md` 首次退出 3，指出 EOF 多余空行；只修正文档空行后复检退出 1，无空白错误（no-index 比较新增文件与空文件存在差异，1 不代表零差异；仍有 LF→CRLF 提醒）。

## 8. 顶栏标题采纳上游：本轮实施记录

助手，本轮 taskId=`merge-title-upstream-alignment`，sliceId=`title-only`，implementationId=`title-align-1`，basedOnReportId=null（任务包未提供）。状态：最小修改已实施，完整契约门禁受产物不同步阻塞，非最终合并验收。

最新明确授权覆盖历史第 3、4 节与根提交消息的保留标题要求：只采用上游无顶栏标题形式。已读取适用 AGENTS、根引用规则、CSS-TOKENS 与 BASELINE；根 `.limcode` 检索、内层空目录及 cached 契约标识检索未发现适用 durable task/report contract（cached 搜索退出 1），不创建自定义任务状态文件，在此记录本 taskId。

- 核实 `MERGE_HEAD:src/today-trend-view.js` 使用 `aria-label="今日风向"` 且无该 h2。
- 内层全量搜索 `pm-today-trend-title`：精确标题 ID 仅在目标模板、既有标题测试及旧 index.js 产物中；另外命中的是模块标题行 class `pm-today-trend-title-row`，不是该 ID 的消费者。未发现业务事件、DOM 查询或持久化依赖。调用方为 phone-ui 与 phone-controller，顶栏 CSS 使用 flex 布局，无该 ID 依赖。
- `src/today-trend-view.js:95` 仅替换 section 命名属性并移除该 h2；`${firstUseSettings}`、`${content}`、`${navigation}` 及全部按钮与状态插值保留。无公共函数签名、类型或持久化格式变更，无需迁移。
- `scripts/check-today-trend.mjs:841–843` 改为无该 h2、无悬空标题引用、有正确 section aria-label 三条断言。根 `merge-commit-msg.txt:6,10` 仅更新标题裁决和对应测试描述。
- 本轮没有改 APP 归档数据保留、溯及既往楼层更新或外部事件收起/展开实现；不据此追加其历史等价性验收结论。

本轮检查均在内层 cwd 执行，逐项记录退出码：`node scripts/check-today-trend.mjs` = 0；`node scripts/check-behavior.mjs` = 0（均有故障测试日志）；目标源码与测试各自 `node --check` = 0；`git diff --check` = 0（有 LF→CRLF 提醒）。`node scripts/check-contracts.mjs` = **1**：`index.js: bundle does not exactly match an in-memory esbuild rebuild`。检查器 :66–80 使用 `write:false` 后比较 bundle；源码标题已变而现有 index.js 仍含旧标题，因此不能把本轮 contracts 写成通过。未重试或绕过该检查，未修改 checker，未运行会写产物的 build；仅执行 checker 内存构建。

改前为 118 项暂存、30 个 AD 删除及 index.js 未暂存、本文未跟踪；两目标源码/测试改前无未暂存差异。改后新增未暂存差异仅为 view 1增/1删、测试3增/1删，另有本文补记与根提交消息两行。cached diff 管道摘要仍为 `8a7b55b0bbfa90012fd5379669f9777c0369322f`；排除两目标后的既有工作树 diff 摘要仍为 `c2b0bc4420acd6a182c10e44a671b97a3ec47387`，包含 index.js 与特别 UI 的既有差异未动。HEAD 与 MERGE_HEAD 不变；未调整索引或引用。

剩余工作：需另行授权产物发布/同步流程后复跑 contracts；本轮不执行。未浏览器验证视觉、亮暗主题、移动端或辅助技术，源码依赖与测试支持最小采纳，不保证绝对无影响。回退仅反向撤销本轮两处模板编辑、三条标题断言、根两行描述及本文补记，保留历史正文和所有已有暂存/未暂存改动，不使用 reset/checkout。


### 8.1 同任务恢复：构建同步解除阻塞

助手，继续 taskId=`merge-title-upstream-alignment`、sliceId=`title-only`、implementationId=`title-align-1`、basedOnReportId=null（未提供报告 ID）。本次恢复的构建与指定机器检查已通过，先前产物不同步阻塞已通过正常构建解决；这不是最终合并或生产验收声明。第 8 节上述失败和未执行记录保留为真实历史；上轮禁止 build 是主会话执行边界，不是助手要求，本轮已明确授权仅同步产物工作树。

构建前核验：`package.json` 无 prebuild/postbuild，既有 build 为 `esbuild src/main.js --bundle --format=iife --platform=browser --target=es2020 --outfile=index.js --legal-comments=none --minify-syntax --minify-whitespace`，无其他输出配置。除复用第 5 节改前 contracts 通过证据外，本轮将索引中的改前 `src/today-trend-view.js` 仅通过 esbuild 内存 onLoad 提供，其他源码仍读取当前工作树，使用相同构建参数及 `write:false`；所得 bundle 与构建前 index.js **逐字节完全一致**，内存输出列表仅 index.js。该验证不写源码、不改变 checker，证明既有产物差异可从改前源码再生，未发现手工独有内容，不是丢弃既有修改后重置为 HEAD。

- 旧 bundle：1528431 bytes，SHA-256=`bb1e22669f6b392c696cdd5e68a8397872b641c8cf0606158036761fed03f583`。
- 新 bundle：1528371 bytes（减少 60 bytes），SHA-256=`17e4497bc7b447e4f1041e8e4af4553114779d6cb5e45dac7a8fdc810c5f319e`；contracts 确认与当前源码的内存重建完全一致，phase 0 delta=151156。

本轮命令在内层仓库顺序执行，每项立即核对退出码：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run build` | 0 | 既有 esbuild 命令同步 index.js 工作树 |
| `node scripts/check-contracts.mjs` | 0 | Static contracts verified，旧 bundle mismatch 阻塞解除 |
| `node scripts/check-today-trend.mjs` | 0 | Today trend contracts verified；有 IDB unavailable 与 journal 清理故障测试日志 |
| `node scripts/check-behavior.mjs` | 0 | Behavior configuration verified；有注入存储失败、自动消息失败与分支失败日志，非无警告 |
| `npm run check:syntax` | 0 | 新 index.js 语法通过 |
| `node --check src/today-trend-view.js` | 0 | 标题源码语法通过 |
| `node --check scripts/check-today-trend.mjs` | 0 | 标题测试语法通过 |
| `git diff --check` | 0 | 未暂存空白检查通过，有 LF→CRLF 提醒 |
| `git diff --cached --check` | 0 | 暂存空白检查通过 |

写入边界：本次恢复仅正常构建写入 index.js，并向本文追加 8.1 节；未再改业务源码、测试、保护 UI、根提交消息、依赖或配置，未执行 Git 写操作。构建前后，对内层所有 tracked/untracked（排除 ignored）路径去重排序，以路径、文件字节及缺失标记计算 SHA-256，排除本次两个写入目标后均为 `6e58ae0a00baba6ddbefcc8716ede0bc502d32713b40c777517e24d7afa5e3bf`，既有 AD 删除、标题修改及其余文件内容保持不变。

索引与引用复核：cached diff 管道摘要仍为 `8a7b55b0bbfa90012fd5379669f9777c0369322f`；HEAD=`fef9261476778b5c5340c6d07b9136255d99b68d`、MERGE_HEAD=`c25cba2d9fbe85e60447269a7b40ce6443d367b1`，均与恢复前及历史锚点一致。`:index.js` 与 `HEAD:index.js` 的 blob 同为 `1e41f7a78dad9ec5dafa21573d2d2b972ad6ad1c`；`git diff --cached --numstat -- index.js` 为空。index.js 状态为 ` M`，**工作树已同步但未暂存，索引仍与第一父一致，不入当前暂存提交树**；本文仍为未跟踪文档。未 add/commit/push，不能保证后续操作不会改变提交范围。

剩余限制：未执行全量 npm run check、浏览器视觉、亮暗主题、移动端、辅助技术或真实宿主验收；其他合并遗留问题仍见第 6 节，不因本次定向门禁通过而自动关闭。后续发布仍需明确源码与第一父旧产物的提交/部署边界。

回退说明（未执行）：仅撤回本次 8.1 补记；产物如需回退，应先核对当前状态，再用上述已验证的改前 view 内存重建路径恢复旧 bundle 并校验旧 SHA-256，不应还原 HEAD 产物或 reset/checkout 工作区，以免丢失本次恢复前已有 bundle 与源码合并成果。
