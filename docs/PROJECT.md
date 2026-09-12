# Today Trend v2 生产治理项目

## 项目入口

- 唯一业务范围：`public/mobile-ui-private`。
- 当前阶段、阻塞、风险、结论和下一步只以 `.limcode/progress.md` 为权威；本文件不复制实时状态，只维护长期工程约束。实施计划只维护阶段范围与验收条件，设计文档只维护目标契约，历史记录不得覆盖当前状态。
- 核心设计：`.limcode/design/today-trend-event-history-date-segmentation.md`。
- 实施计划：`.limcode/plans/today-trend-v2-production-implementation.plan.md`。
- 项目进度：`.limcode/progress.md`。
- 已终止的手机内页面与弹窗收敛项目不再是依赖、阻塞或文件 owner 协调项。

## 每次工作前强制阅读

1. 本文件；
2. `.limcode/plans/today-trend-v2-production-implementation.plan.md`；
3. `.limcode/design/today-trend-event-history-date-segmentation.md`；
4. `.limcode/progress.md`；
5. `docs/BASELINE.md`；
6. `docs/LIFECYCLE-RESOURCES.md`；
7. 涉及 UI/CSS 时读取 `docs/CSS-TOKENS.md`；
8. 当前动作涉及的源文件、全部调用方、配置、CSS 选择器和检查脚本。

文档、计划、代码或进度冲突时，先依据磁盘和测试证据修正状态，不得按过期前提继续。

## 阶段状态与边界

- 阶段 0 已完成：治理过期项目状态；冻结当前 v1 store、注入、生成、调度和 UI fixture；记录 bundle、存储、注入、检查与资源基线；建立确定性 PRNG、seed replay、fault schedule 和长序列 runner。
- 阶段 1 只建立独立 v2 authority、兼容桥、epoch/revision CAS 与多标签失权语义，不实施业务迁移、journal/saga、结构化 projection、摘要、UI 或 AI 服务切换。
- `public/mobile-ui-private` 是独立仓库；提交只在该仓库内进行。阶段 0 的异常临时文件已清理，不再作为项目阻塞。

## 硬门禁

- 必须先发布兼容桥并使用独立 v2 authority/key；禁止在 v1 key 中仅靠 payload version 自保；
- authority 状态不可读取时，读写都必须 fail-closed：不能返回无法证明新旧程度的 v1 fallback，也不能降级写入 v1；恢复路径是先恢复 `PhoneModeDB/kv` 的 authority 可读性，再重新加载数据；
- v2 写入与 authority 更新必须由同一个 IndexedDB `readwrite` 事务提交；`BroadcastChannel` 只通知失权，不参与授权判定；
- active owner 未显式 `release` 前，其他标签的 `acquire` 必须返回 `TT_AUTHORITY_BUSY`；阶段 1 禁止 lease、超时和 takeover；
- 同一 authority 实例的 `acquire`、`save`、`release` 必须通过失败可恢复的 FIFO 串行；active token 或 pending mutation 存在时禁止 `close`，release CAS conflict 必须抛出明确错误而非返回成功；
- 临时 authority 保存成功但释放失败时，错误必须携带已提交 receipt；任何补偿都必须使用该 receipt 的 `storeRevision` fence；
- 阶段 1 不触碰 journal、迁移或业务模型；`writeV2` 与 `serveV2` 不得默认开启；
- 摘要必须来自 `buildTodayTrendGenerationEnvelope` 同一次 AI 返回；禁止独立摘要 AI 调用；
- `renderTodayTrendInjection` 保持仅输出 active event 的最小字段，摘要不得进入注入正文；
- 监听器、timer、observer、AbortController 和异步闭包必须有唯一 owner 与显式释放路径；
- 不修改 `ST_SMS_DATA_V2`、注入失败 key或日历缓存；两处既有 empty-block 已在阶段 1 启动前以无行为变化的注释修复并通过语法检查；
- 默认继续 Node check 体系，不引入 fast-check；
- bundle 的 `1488263` bytes 仅作为历史参考线；每阶段记录当前值、相对阶段 0 的净增量和主要增长来源，不以该旧数值单独阻断新增功能；
- 禁止为迎合旧 bundle 参考线删除或晦涩化生产功能、校验、错误信息、可维护结构或 CSS；`<current_today_trend>` 仍不得超过 12000 字符；
- 阶段完成后运行与改动范围匹配的构建、专项检查和 `git diff --check`；全量检查中的既有 calendar 基线失败单独记录，不得误归因给 Today Trend v2；验证通过后可做中文 commit，禁止 push；
- 阶段 0 的真实宿主重复回归由助手基于当前已测试版本明确豁免。后续仅在改动真实 UI/生命周期或进入最终发布阶段时执行对应宿主验收，不机械重复无关循环。

## 验证与复杂度收敛

- 新增测试或机器门禁前，必须写明它阻止的生产故障、故障的用户或数据影响、现有验证为何不能覆盖，以及该门禁的删除条件；缺少其中任一项不得新增；
- 优先验证运行时行为、持久化结果和资源释放。只约束变量名、语法写法、注释、文本片段或实现形态的检查，不得替代行为验证；短生命周期实现约束默认不进入全局合同；
- 检查器的自测只覆盖检查器自身容易产生误判且会放过生产故障的最小样本。不得为了证明检查器完备而枚举语言语法；专项测试已覆盖同一故障时，`check:contracts` 不得重复导入并再次自测；
- 每项新增生产逻辑、测试和文档必须能映射到当前阶段目标。无法映射、只验证测试工具自身、或仅复制其他文档状态的内容应删除；
- 每个可交付单元结束时比较生产源码、测试、合同和文档的增量。测试与合同增长明显超过生产逻辑时，必须逐项证明故障覆盖，不以“生产级”为理由自动接受；
- 独立验收默认只执行一次终验。若发现问题，修复后只复验受影响机制及必要回归；只有发现新的故障机制、证据范围变化或前次验收无效时才能增加一轮，并记录原因。不得以“零 finding”为目标无限扩张检查器；
- 验收停止条件：阶段专项与耦合域检查通过，已知故障模型均有直接验证，`git diff --check` 通过，剩余失败已确认是修改前基线或明确阻塞。满足后停止增加门禁和审查轮次，转入下一业务目标。

## 文档同步

- `.limcode/progress.md`：仅在阶段、阻塞、风险、当前结论或下一步发生变化时更新；
- 实施计划：仅在阶段范围、依赖、验收条件或执行顺序变化时修订；普通进度只同步 TODO 状态；
- 本文件：仅在长期工程约束或权威分工变化时更新；
- `BASELINE`、`CSS-TOKENS`、`LIFECYCLE-RESOURCES`：仅由对应基线、视觉合同或真实运行时资源变化触发；测试脚本局部对象不登记为生产生命周期资源；
- 同一事实只在一个文件中拥有最终解释权，其他文档使用引用，不复制易漂移的状态段落。阶段要求的自动验证与适用人工验收未通过前，不得进入下一阶段。

## 2026-08-12 收敛记录

- 删除 `check-contracts.mjs` 中没有生产调用、只被自身语法样本调用的静态名称检测器；三开关默认关闭继续由 authority 默认值与行为测试验证；
- 删除 contracts 对 Today Trend 测试基础设施的重复导入自测；PRNG、fault schedule、replay 和 owner 序列继续由 `check:today-trend` 的真实路径验证；
- 从生命周期资源文档移除脚本退出即释放的局部 PRNG、Map 和 trace，避免把测试实现误记为生产资源；
- 保留独立 v2 key、单事务 CAS、epoch/revision、FIFO、失权 writer、rollback fence 与 fail-closed 行为及其直接回归测试。此次收敛删除的是流程和检查器自证，不降低数据一致性保障。
