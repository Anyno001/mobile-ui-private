<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/today-trend-entry-content-rail-alignment.md","contentHash":"sha256:b004db2ee96ad96d04a408996bb10fb30a379c5c2bf5e9c057d19bed4e25dd42"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结当前条目 DOM、完整 CSS 层叠与既有 minimal/关系节点契约，确认本次仅影响样式轨道。  `#today-trend-rail-baseline`
- [x] 先在契约检查中锁定世界、风评与势力条目的节点—标题—摘要三列轨道、节奏与非回归边界。  `#today-trend-rail-contracts`
- [x] 以 CSS Grid 收敛三类条目的标题与摘要文本轨道，移除世界态势无语义内缩和死覆盖规则。  `#today-trend-rail-css`
- [x] 完成构建、专项/全量检查、diff 卫生、窄屏与可访问性回归，并接受独立验收。  `#today-trend-rail-validation`
<!-- LIMCODE_TODO_LIST_END -->

# 今日风向条目内容轨道收敛

## 计划来源与确认边界

- **来源设计**：[`today-trend-entry-content-rail-alignment.md`](../design/today-trend-entry-content-rail-alignment.md)。
- **需求来源**：助手明确要求整理“世界态势、个人风评、实力图谱”模块内条目的标题与摘要轨道；不调整模块总标题。
- **实施边界**：仅修改条目布局和其可机器验证的 CSS 契约。不得修改数据模型、存储、版本、生成链、交互 action、ARIA、SVG path、模块总标题、全局内容区 padding、关系色或 meter 选中态。
- **当前风险**：真实 SillyTavern 宿主尚无本轮截图/测量证据；自动检查只能证明结构与 token 契约，不能替代亮暗主题、窄屏和实际命中区的人眼验收。

## 已核实的问题与目标契约

### 已核实原因

1. `trendModuleHead()` 为三个模块生成同一模块总标题结构，故问题不在模块标题 DOM。
2. 世界态势的 `.pm-today-trend-world-hero/.pm-today-trend-world-brief` 具有额外 `--pm-space-3` 内边距；模块外层已有 `--pm-space-4`，于是无视觉表面的条目制造了第二层横向缩进。
3. 世界态势标题位于 `24px signal marker + 8px gap` 之后，而其摘要目前从条目自身左边起排；个人风评、势力图谱则让标题在 relation slot 后、摘要回到模块左缘。三者都未满足“同一条目的标题与摘要在同一文本列”这一基本关系。
4. 势力树非根节点由 `--pm-today-trend-faction-nested-indent` 表达父子关系，必须保留；只统一各层级条目内部的节点、标题和摘要轨道。
5. 世界模块头存在前段定义、后段覆盖的重复 margin/padding 规则。最终视觉由后段规则决定；保留互相抵消的历史声明会让未来的顺序调整重新引入漂移。

### 目标几何

对 world/reputation/faction 的根级条目，以及 faction 的每一个嵌套局部条目，建立：

```text
[模块或嵌套树的内容左缘]
  ├─ 第 1 列：24px signal marker / relation slot
  ├─ 第 2 列：--pm-space-2
  └─ 第 3 列：minmax(0, 1fr) 标题与摘要共同文本轨道
```

- 标题到摘要统一经 `gap: var(--pm-space-2)` 留白。
- world hero 与 brief 继续保留各自字体层级，faction 的详情与 rating 继续跨全列；统一位置不等于抹平信息层级。
- normal/minimal 都使用同一几何。minimal 的 44px relation button 保持 slot 内绝对定位和既有可访问性，不重新作为 flex/grid 列宽参与者。

## 实施任务与依赖

### 1. 冻结实施前选择器与层叠边界

**依赖：无；必须先完成。**

**文件**：`styles/today-trend.css`、`src/today-trend-world-view.js`、`src/today-trend-reputation-view.js`、`src/today-trend-faction-view.js`、`src/today-trend-ui.js`、`scripts/check-contracts.mjs`。

1. 逐一复读 world hero/brief、reputation entry、faction card 的 DOM 邻接关系，确认 CSS 可以把 header、摘要、detail、rating 精确放入 grid 列，且无需添加仅为样式服务的 DOM wrapper。
2. 搜索目标选择器的全部定义、minimalUi/320px 覆盖、关系 slot 的 absolute 44px button 规则、overflow 链和 `styles/overrides.css` 覆盖；记录最终有效声明而非被前序规则掩盖的历史值。
3. 搜索 `pm-today-trend-world-hero`、`pm-today-trend-world-brief`、`pm-today-trend-reputation-entry-body`、`pm-today-trend-faction-entry-body` 的所有消费者，确认其仅为渲染样式钩子，不被行为逻辑依赖。
4. 确认现有 `check:today-trend` 与 `check:contracts` 的断言入口；保留既有 relation node、SVG、minimal 44px hit target、nested indent 的断言。

**完成标准**：输出目标元素—CSS 规则—覆盖规则的可复核映射；一旦发现 JS/宿主 CSS 对这些视觉 class 存在行为耦合，停止 CSS 设计并先修订计划，而不是拿 `!important` 盖过去。

### 2. 先扩展 CSS 契约，锁定轨道和非回归边界

**依赖：任务 1。**

**文件**：`scripts/check-contracts.mjs`；仅在需要登记新例外时才修改 `scripts/css-governance-registry.json`，预期不需新增 token 或例外。

1. 为 world hero/brief 断言统一三列 `grid-template-columns`：relation-node-size、space-2、`minmax(0,1fr)`；header 必须跨全列、摘要必须位于第三列、条目透明 padding 必须为 `--pm-space-0`。
2. 为 reputation/faction 的 entry body 断言同一三列几何，摘要分别位于第三列；reputation rating、faction detail 和 faction rating 必须跨全列，防止有交互/资料价值的内容被挤入标题列宽。
3. 断言 world/reputation/faction 的摘要起排节奏来自 `--pm-space-2`，不再依赖 hero/brief 特化的 `margin-top`。断言不得引入裸间距、负 margin、`translateX`、scale 或未登记私有 token。
4. 保留并显式复验 faction 非根树缩进、relation slot 的 24px 可见尺寸、minimal 44px absolute button、18px SVG、focus/disabled 选择器。轨道整改不得误伤这些已交付契约。
5. 对 world module-head 规则加入唯一事实源检查，或用精确存在/不存在断言保证被删除的旧覆盖不会以不同顺序复活。

**完成标准**：改动前检查应精确暴露缺失的轨道契约；实现后检查必须能同时证明对齐关系和关系树/minimal 语义未退化。禁止用整段 CSS 字符串匹配伪造覆盖。

### 3. 仅以 CSS Grid 收敛三种条目轨道

**依赖：任务 2。**

**文件**：`styles/today-trend.css`。

1. 将 world hero 和 world brief 改为三列 grid：`header` 跨 `1 / -1`，直接子 `p` 放入第三列；移除无可见容器意义的条目内层 `--pm-space-3` padding，模块外层 `--pm-space-4` 成为唯一手机左右边距。保留 hero/brief 各自字号 token、内容宽度、文本换行及信号 marker 图标尺寸。
2. 令 `.pm-today-trend-reputation-entry-body` 与 `.pm-today-trend-faction-entry-body` 使用同一三列定义；将风评摘要和势力摘要定位到第三列。让 rating、faction detail 跨列，维持其现有全宽交互与资料阅读布局。
3. 统一三类条目标题—摘要的行间节奏为 `--pm-space-2`：移除/替换 world hero/brief 的特化摘要 margin；不得通过补偿 padding、负 margin、整体 transform 或改变模块根 padding 达成“看起来差不多”。
4. 清除 world module-head 已被后段相同选择器覆盖的历史 margin/padding 声明，确保只保留已证实的最终值；重读该区段确认未误删伪元素、计量、工具栏和 minimal 覆盖。
5. 审查 `@media(max-width:320px)`：保留现有窄屏 relation meter、nested tree、长标题换行规则；只有确有 CSS Grid overflow 证据时才做最小响应式调整，且只能使用已登记 token。

**完成标准**：根级 world/reputation/faction 的节点左缘等于模块内容左缘，标题和摘要的左缘等于节点列加 8px；嵌套 faction 只保留其有意树形缩进；normal/minimal 的行为、键盘焦点和 44px 触控尺寸不变。

### 4. 验证、独立验收与回滚准备

**依赖：任务 3。**

1. 分别执行并记录退出码：`npm.cmd run build`、`npm.cmd run check:syntax`、`npm.cmd run check:today-trend`、`npm.cmd run check:contracts`、`npm.cmd run check`、`git diff --check`；若有暂存内容，再执行 `git diff --cached --check`。失败时先归因于实现、断言、既有基线或环境，禁止机械重跑。
2. 在可用宿主中人工验证：亮/暗主题、normal/minimal、320px、长标题/长摘要、world 首项和后续项、reputation、根级与至少一层嵌套 faction、菜单展开、disabled、键盘 focus，以及 minimal relation button 实际 44px 命中。宿主不可用时明确记录为未闭环风险。
3. 确认 diff 仅包含计划内的 CSS 与契约文件（另有构建物时核验由 build 产生），不含数据/schema/prompt/存储变更、临时文件或无关格式化。
4. 代码模式正式交付前调用独立 Acceptance Expert。出现 blocking/major，按结论修复并复验，最多八轮；达到上限仍不收敛时停止自动修复，将证据与遗留问题交给助手决定。

**完成标准**：所有可运行门禁通过，独立验收无 blocking/major；真实宿主未验证不得冒充已验证。

## 验收矩阵

| 验收项 | 自动证据 | 人工证据 |
| --- | --- | --- |
| 三模块根级条目节点/标题/摘要轨道一致 | grid 列、header/span、摘要 column、zero padding、space-2 契约 | 三模块并列对比，标题与摘要左缘同列 |
| world 不再有无意义双重边距 | world hero/brief padding=0、模块 root 仍为 space-4 | 首项和后续简报均不再额外向内缩 |
| faction 信息层级未被拉平 | nested indent 与 detail/rating span 契约 | root、depth 1+ 均保留树层级且摘要按局部文本列对齐 |
| normal/minimal 可访问性未回归 | 既有 slot/44px/SVG/focus/disabled 契约 | 键盘 focus、disabled、状态切换和真实点击区域正常 |
| 窄屏可用 | 320px 规则和 token 治理通过 | 320px 下长文本不溢出、不遮挡、不裁剪 |
| 代码卫生 | build/check/diff/独立验收 | 不含无关文件和不必要设计变更 |

## 风险与回滚

| 风险 | 控制 | 回滚方式 |
| --- | --- | --- |
| 共同文本列使长摘要变窄 | 固定 `minmax(0,1fr)` 和 `overflow-wrap:anywhere`，以 320px 与长文本验证 | 仅恢复本次摘要列定位/网格规则；不触及 DOM、数据或交互 |
| world header 操作菜单改变条目首行高度 | header 跨全列，摘要依靠 row gap 而非绝对坐标 | 调整本次 grid row/column 规则，不改 action menu |
| faction nested indent 被误删或双算 | 契约+人工覆盖 root 和 depth 1+ | 恢复树缩进规则，保持本次条目内部轨道独立 |
| 清理死覆盖时改变最终值 | 先对比计算后的等价值，后以契约验证 | 单独还原被删声明并定位层叠差异；不恢复整块旧样式 |
| 自动门禁绿但真实宿主视觉仍有偏差 | 将宿主检查作为独立验收条件，不把静态检查伪装成截图证据 | 回滚仅本次 CSS/contract 改动，保留前序关系色与触控交付 |

## 自审

本计划没有把“统一轨道”偷换成重写今日风向：只收敛条目内部的横向和垂直关系，明确保留 world 的主次层级、faction 树形深度和全部交互契约。它能执行，但实际视觉是否完全符合助手预期仍需要宿主截图/测量；静态 CSS 再漂亮，也不能替代真实手机视口的验收。
