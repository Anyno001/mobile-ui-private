<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/today-trend-title-svg-mapping.md","contentHash":"sha256:635ae07b4eed9bcaba066c0e1a42e1c2745a4c6af197c264e1e1fe2bdf560e83"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 独立 Acceptance Expert 已 PASSED（blocking=0、major=0、minor=2）；完成交付卫生检查。真实 SillyTavern 视觉/辅助技术回归尚未执行，且推送 main 属外部发布，需助手确认是否接受剩余风险后再提交推送。  `#trend-svg-mapping-acceptance-delivery`
- [x] 冻结今日风向标题 SVG 映射的实施基线：核对工作树、现有 SVG 常量与事件局部图标、两视图调用点、CSS marker 和契约断言，并关闭设计中的关键词/图标重叠歧义。  `#trend-svg-mapping-baseline`
- [x] 扩展 check-today-trend：覆盖 14 类映射、冲突优先级、NFKC、两类兜底、标题唯一输入、两视图一致性及 DOM/无障碍契约。  `#trend-svg-mapping-behavior-contracts`
- [x] 更新 today-trend marker CSS，删除世界 <i> 内核规则并复用现有尺寸与主题 token，不新增裸值、颜色分流、动画或 !important。  `#trend-svg-mapping-css`
- [x] 扩展 check-contracts：锁定两类 marker 的 SVG 尺寸/token、世界 marker 禁止回退为 <i>，并验证 CSS governance 无新增违规。  `#trend-svg-mapping-css-contracts`
- [x] 接入事件追踪视图：移除局部 EVENT_ICONS/eventIcon，按 event.title 调用共用解析器，同时保留 type badge、归档与操作行为。  `#trend-svg-mapping-dynamics-view`
- [x] 将事件追踪局部内容 SVG 提升到 src/icons.js，按现有图标重复性选择唯一常量并保持既有 SVG path 与视觉不变。  `#trend-svg-mapping-icon-catalog`
- [x] 新增 src/today-trend-title-icon-mapping.js，实现固定优先级规则、NFKC 标准化、世界默认与 event type 兜底，且不接触状态或持久化。  `#trend-svg-mapping-resolver`
- [x] 按 build→check:syntax→check:today-trend→check:contracts→check→git diff --check 顺序完成验证，清理临时产物并记录可复核证据。  `#trend-svg-mapping-validation`
- [x] 接入世界态势视图：按 item.name 解析图标，输出 SVG、data-today-trend-icon 与 aria-hidden marker，移除 <i> 圆点结构。  `#trend-svg-mapping-world-view`
<!-- LIMCODE_TODO_LIST_END -->

# 今日风向标题关键词 SVG 映射实施计划

## 1. 计划来源

- 已确认设计：`.limcode/design/today-trend-title-svg-mapping.md`
- 计划目标：在今日风向现有展示层内，为世界态势 `scope.world.items[].name` 与事件追踪 `event.title` 建立统一标题关键词 SVG 映射。
- 来源约束：本计划只落实已确认设计，不扩展为图标配置系统、模型字段或生成分类能力。

## 2. 目标与交付边界

### 2.1 目标

1. 新增纯展示解析模块 `src/today-trend-title-icon-mapping.js`。
2. 世界态势与事件追踪共用同一标题标准化与固定优先级规则表。
3. 世界态势未命中回退 `TODAY_TREND_WORLD_ICON_SVG`；事件未命中先按 `event.type` 回退，再回退普通事件图标。
4. marker 输出稳定的 `data-today-trend-icon`，保留标题文本和 `aria-hidden="true"`。
5. 用专项契约、CSS governance、全量门禁及独立验收锁定行为。

### 2.2 明确不做

- 不修改 `TODAY_TREND_VERSION`、schema、normalize、store、备份、导入导出、分支继承或生成 prompt。
- 不向世界态势或事件数据写入 `icon` / `iconKey`。
- 不扫描 summary、origin、latestStage、participants、聊天正文或世界书正文。
- 不增加用户配置、动态正则、AI 分类、第三方依赖或按关键词着色。
- 不手工修改构建产物 `index.js`；只通过 `npm.cmd run build` 更新。

## 3. 已确认影响面

| 文件 | 计划内职责变化 |
| --- | --- |
| `src/icons.js` | 接收事件追踪当前局部内容 SVG；复用已有语义图标，避免重复所有权。 |
| `src/today-trend-title-icon-mapping.js` | 新增：标题标准化、14 类规则、优先级、world/event 兜底，返回 `{ key, svg }`。 |
| `src/today-trend-world-view.js` | 用 `item.name` 解析 SVG，替换固定 `<i>` marker。 |
| `src/today-trend-dynamics-view.js` | 删除局部 resolver，改用公共解析器；badge、归档、菜单和编辑行为保持原状。 |
| `styles/today-trend.css` | 删除世界 marker 的 `<i>` 内核规则，统一约束 marker 内 SVG 尺寸。 |
| `scripts/check-today-trend.mjs` | 锁定规则、冲突、兜底、输入边界及视图 DOM/无障碍契约。 |
| `scripts/check-contracts.mjs` | 锁定 SVG/token/CSS governance，并禁止世界 marker 回退为 `<i>`。 |
| `index.js` | 仅由构建生成并接受 bundle 一致性校验。 |

## 4. 实施前决策门

实施第一步必须重新读取准确源码片段并记录结论，不能凭摘要直接改：

1. **SVG 去重**：逐项比较 dynamics 局部 `location/signal/rumor/document/incident/normal/underground` SVG 与 `src/icons.js` 现有常量。字节或视觉语义一致时复用已有常量；不一致时迁移原 path，禁止借机重画。
2. **`报告` 关键词歧义**：设计的冲突示例要求 `新区发展趋势报告 → document`，但 14 类关键词表未列出 `报告`。本计划采用“具体冲突契约优先”的保守解释，将 `报告` 纳入 `document` 规则；批准本计划即确认该收敛。若不接受，必须先修订设计与计划，不能让实现和测试各猜一套。
3. **天气 SVG 选择**：确认 `weather-storm` 与 `weather` 对应现有天气常量，固定 key→SVG catalog 映射，避免两个视图自行选图。
4. **工作树隔离**：记录 `HEAD`、`git status --short` 和目标文件 diff。若存在重叠的未提交改动，停止实施并先确认归属；不得覆盖或混入此前 bgr 专项。

## 5. 分阶段实施步骤

### 阶段 A：冻结基线与集中 SVG catalog

#### A1. 核对现状

- 精读 `src/icons.js`、`src/today-trend-dynamics-view.js`、`src/today-trend-world-view.js` 的准确导入、常量、resolver 和 marker 模板。
- 精读 `styles/today-trend.css` 中世界/事件 marker 规则。
- 精读 `scripts/check-today-trend.mjs` 与 `scripts/check-contracts.mjs` 的相关断言，记录必须替换的 `<i>` 基线及既有尺寸 token。
- 搜索 `EVENT_ICONS`、`eventIcon`、`.pm-today-trend-world-signal-marker`、`.pm-today-trend-event-marker` 的全部引用，确认没有第三个消费方。

**验收**：形成一份可复核的“常量→调用方→DOM→CSS→测试”对应表；任何未解释调用方都会阻塞后续修改。

#### A2. 提升事件 SVG

- 将局部事件 SVG 移入 `src/icons.js`，命名体现今日风向事件语义。
- 已有常量足以表达且图形一致时直接复用，不制造同图异名常量。
- 保持原 SVG path、`viewBox`、`fill="none"`、`stroke="currentColor"` 等视觉属性，不改变线宽和形状。
- 此阶段只移动所有权，不接入新映射，以便 diff 可单独审查。

**验收**：dynamics 既有图标具备集中导出；迁移前后 SVG 结构等价；无循环依赖。

**回滚点 R1**：仅回退 `src/icons.js` 的新增导出，视图尚未切换，风险最小。

### 阶段 B：实现纯解析器

#### B1. 建立 catalog 与规则表

- 新建 `src/today-trend-title-icon-mapping.js`。
- 在模块内部维护不可变 key→SVG catalog 和按设计顺序排列的 14 条规则。
- `document` 规则按决策门纳入 `报告`；禁止单字宽泛关键词。
- 规则只能读取标准化后的 title，首个命中立即返回。

#### B2. 标准化和兜底

- 标准化顺序固定为：`String(title || '')` → `normalize('NFKC')` → trim/折叠空白 → 小写。
- world 入口未命中返回 `{ key: 'world-default', svg: TODAY_TREND_WORLD_ICON_SVG }`。
- event 入口未命中按 `incident`、`rumor`、`underground`、`normal/未知` 返回固定事件 SVG。
- 标题命中始终优先于 event type。
- 导出最小公共 API；不得导出可被视图任意重排的内部规则细节，测试优先通过公开 resolver 验证。

**验收**：模块无 store/model/UI 副作用，无动态 `RegExp`，无外部配置，无输入对象修改；同一标题在 world/event 命中时 key、SVG 一致。

**回滚点 R2**：删除新增模块即可，不影响数据或现有视图。

### 阶段 C：接入两个视图

#### C1. 世界态势接入

- 在 `src/today-trend-world-view.js` 中按 `item.name` 调用 world resolver。
- marker 保留 `.pm-today-trend-world-signal-marker` 和 `aria-hidden="true"`。
- 输出 `data-today-trend-icon="<key>"` 与解析得到的 SVG，删除 `<i>`。
- 标题 `<b>`、summary、列表顺序与其他结构保持不变。
- key 若进入 HTML 属性，沿用项目既有安全模板策略；规则 key 必须来自内部固定 catalog，不能回显标题。

#### C2. 事件追踪接入

- 在 `src/today-trend-dynamics-view.js` 删除局部 `SVG`/`EVENT_ICONS`/`eventIcon` 所有权。
- 按 `event.title` 和 `event.type` 调用 event resolver。
- marker 增加 `data-today-trend-icon`，保留 `data-event-type` 与 `aria-hidden="true"`。
- 保留 badge、active/archived 状态、编辑、删除、菜单、时间线及 rerender 行为。
- 不把 summary/origin/stage/participants 传入 resolver。

**验收**：世界和事件视图只消费 resolver 结果，不再保存平行关键词判断；编辑标题后的常规 rerender 会重新解析，无迁移或缓存失效问题。

**回滚点 R3**：两个视图可分别回退；公共解析器和 catalog 为无副作用死代码，可随后删除。

### 阶段 D：CSS 与契约

#### D1. CSS 收敛

- 删除 `.pm-today-trend-world-signal-marker > i` 专用内核规则。
- 为世界 marker 内 SVG 使用已有 `--pm-size-icon-md`，事件 SVG 规则保持现有 token。
- 保留世界节点外框 `--pm-today-trend-relation-node-size`、事件 marker 尺寸、accent/on-accent 主题配对和 `currentColor`。
- 不新增裸颜色、裸尺寸、间距、圆角、阴影、z-index、动画时长或 `!important`。

**验收**：世界和事件 marker 在现有 token 下对齐；CSS governance 无 added/stale fingerprint 或 legacy value 漂移。

#### D2. `check-today-trend` 行为契约

测试至少覆盖：

1. 14 类 key 各一个正向标题，防止规则表漏接或 SVG catalog key 错配。
2. 冲突优先级：`暴雨侵袭港口航线 → weather-storm`、`港口签署通航协议 → document`、`城市辟谣发布会 → rumor`、`机场联络窗口开放 → signal`、`新区发展趋势报告 → document`。
3. 标题命中优先于 type：如 location 标题 + incident type，图标为 location，badge/type 仍为 incident。
4. 空标题、空白、未知标题：world→world-default；event→对应 type；未知 type→event-normal。
5. NFKC：包含全角英数/空白变体的输入得到与规范标题一致结果；仅验证规则真实包含的字符，不编造英文关键词。
6. 同一命中标题在 world/event 返回相同 key 与 SVG。
7. summary、origin、latestStage、participants 中单独出现关键词不影响图标。
8. 世界和事件 marker 均有 `aria-hidden="true"`、稳定 `data-today-trend-icon`，标题 `<b>` 仍存在。
9. 世界 marker 不再含 `<i>`；事件 type badge、archived/active DOM 契约不回归。
10. 原事件 location/signal/rumor/document 关键词与 type fallback 均有迁移回归用例。

#### D3. `check-contracts` CSS/结构契约

- 更新世界 marker 的旧 `<i>` 期望为 SVG + token 期望。
- 锁定世界和事件 SVG 使用现有尺寸 token，且 SVG 前景遵循 `currentColor`。
- 增加禁止世界 marker 恢复 `<i>` 的结构断言，避免视觉倒退。
- 继续使用现有 CSS governance 机制；除非实现确实引入经审查的 baseline 变化，否则不得机械刷新 registry 掩盖失败。

**验收**：专项测试能对错误优先级、摘要误扫描、错误 type 回退、缺失属性、`<i>` 回退和裸 CSS 值产生确定失败。

**回滚点 R4**：CSS、行为契约和结构契约与视图改动成组回退；不得只回退测试来换绿灯。

### 阶段 E：验证、独立验收与交付

#### E1. 自动验证

每条命令单独执行，使用 `npm.cmd`，不得用 `&&` 串联：

1. `npm.cmd run build`
2. `npm.cmd run check:syntax`
3. `npm.cmd run check:today-trend`
4. `npm.cmd run check:contracts`
5. `npm.cmd run check`
6. `git diff --check`

失败时先区分实现缺陷、断言缺陷、构建产物不一致和环境故障；不得重复执行同一个已知错误动作，也不得把既有噪音写成通过证据。

#### E2. 证据与卫生

- 保存各命令 exit code 和关键输出摘要。
- 核对 `git diff --stat`、目标文件 diff、`index.js` 仅由 build 生成。
- 确认没有 package/lock 变更、临时脚本、日志、缓存、测试产物或无关文档进入 diff。
- 确认改动相对已推送 bgr 专项可清晰分离。

#### E3. 独立验收

调用 Acceptance Expert，提供：

- 已确认设计与本计划路径；
- 规则表、fallback、DOM/CSS、非持久化边界逐项证据；
- 全部门禁 exit 0；
- diff/stat 与临时产物清理证据。

存在 blocking/major 时修复后重新验收；最多 8 轮。未获得独立 `PASSED` 前不得把验收 TODO 标为 completed。

#### E4. 人工宿主回归

在真实 SillyTavern 宿主验证亮色、暗色、自定义主题、世界首项/后续项、事件 active/archived、多行标题、窄屏、编辑后 rerender、badge 与操作菜单。若当前环境无法执行，明确记录为发布阻塞或经助手接受的剩余风险，不能伪称完成。

#### E5. 交付

- 提交前再次执行 staged diff 检查与敏感/临时文件检查。
- 只有自动门禁、独立验收和要求的人工回归满足后，才按助手批准的发布流程提交并推送 `main`。
- 推送后核对本地 `main` 与 `origin/main` 一致、工作树干净。

## 6. 依赖与并行关系

```text
A1 基线盘点
 ├─> A2 SVG catalog ─> B resolver ─> C1 world ─┐
 │                              └─> C2 event ─┼─> D1 CSS
 │                                             ├─> D2 behavior contracts
 │                                             └─> D3 CSS contracts
 └────────────────────────────────────────────────> E validation
```

- A2 与 resolver API 设计可在 A1 结论后并行准备，但 resolver 合并前必须确定 catalog 常量。
- C1 与 C2 可在 resolver 稳定后并行实施。
- D1、D2、D3 可并行编写，但必须以最终 DOM 与 key 命名为准后一起验证。
- 全量验证、独立验收、人工回归和交付严格串行，不能提前宣告完成。

## 7. 风险控制

| 风险 | 控制措施 |
| --- | --- |
| 中文子串误命中 | 固定多字词、固定优先级、冲突测试、只扫描 title。 |
| 规则与示例自相矛盾 | 实施前关闭 `报告` 歧义；规则、示例、测试使用同一契约。 |
| SVG 迁移导致视觉漂移 | 先比对现有 catalog；原 path 原样迁移；禁止顺手重画。 |
| 两视图再次分叉 | 视图不得保留关键词 if/regex；统一消费 resolver。 |
| type badge 与标题图标混淆 | 图标按标题优先，badge 继续表达 type，并用组合用例锁定。 |
| DOM/CSS 回退为裸圆点 | 删除 `<i>` 规则并增加行为与结构双重契约。 |
| CSS governance 被机械刷新掩盖 | 先定位具体违规；只有经设计批准的 baseline 变化才能登记。 |
| 构建产物不一致 | 源码修改后先 build；禁止手改 `index.js`。 |
| 持久化边界被误侵入 | diff 审查禁止 model/store/schema/prompt/backup 改动。 |
| 发布混入无关改动 | 开工和交付两次核对工作树、diff/stat、临时文件与锁文件。 |

## 8. 整体回滚策略

该功能无数据迁移，允许代码级整模块回滚：

1. 回退 world/dynamics 两视图到旧 marker/resolver。
2. 回退 `styles/today-trend.css` 的 SVG marker 规则。
3. 删除公共 mapping 模块并回退 `src/icons.js` 的提升常量。
4. 同步回退对应契约测试。
5. 重新 build 并运行同一验证链，确认 bundle 与基线一致。

回滚不得修改或清理历史世界态势、事件、备份和分支数据，因为本功能从未写入这些边界。

## 9. 完成标准

只有同时满足以下条件才算完成：

- 14 类固定规则、优先级、world/event 兜底与 `报告` 决策一致落地。
- 两视图使用同一 resolver，世界不再输出 `<i>`，事件既有 badge/操作行为无回归。
- 不存在 model/store/schema/version/prompt/backup/依赖变更。
- CSS 全部复用既有 token，SVG 使用 `currentColor`，governance 无违规。
- build、专项门禁、全量 `check`、`git diff --check` 全部 exit 0。
- 独立 Acceptance Expert 无 blocking/major；要求的真实宿主回归已有记录。
- 临时产物清零，diff 可分离，交付后分支同步且工作树干净。

## 10. 计划自审

这份计划已覆盖调用链、规则冲突、DOM、CSS、测试、构建、验收和回滚，执行顺序也允许在 resolver 稳定后并行接入两个视图。仍有一个刻意暴露的设计瑕疵：`报告` 未出现在原关键词表，却出现在冲突契约里。本计划没有装作它不存在，而是明确采用“具体冲突契约优先”并把批准计划作为确认点。除此之外，真实宿主视觉回归无法由静态门禁替代；若缺少宿主环境，发布就仍有视觉风险，别拿一串 exit 0 自欺欺人。
