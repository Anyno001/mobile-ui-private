# 今日风向条目标题与摘要轨道收敛

## 目标

统一“世界态势”“个人风评”“势力图谱”的模块内条目排版基线：根级条目的视觉节点从模块内容左缘开始，标题与摘要共享同一文本轨道；标题至摘要的垂直节奏固定为 `--pm-space-2`。解决世界态势额外 12px 条目内缩、以及三模块摘要各自落在不同横向位置的问题。

## 已确认现状

- `trendModuleHead()` 为三个模块输出同一模块标题结构；本次不调整模块总标题。
- 世界态势条目 `.pm-today-trend-world-hero/.pm-today-trend-world-brief` 在模块 16px 外边距之内又应用 `padding: --pm-space-3`，使 marker 起点为约 28px；标题在 marker 后，摘要却回到该条目内边距起点。
- 个人风评和势力图谱根级关系槽位起点为模块内容左缘，标题在 `24px slot + 8px gap` 后；其摘要当前回到内容左缘，而非标题文本轨道。
- 势力树的非根节点通过 `--pm-today-trend-faction-nested-indent` 表达父子层级；这不是错误缩进，不能为了“齐”而抹掉。
- 既有 CSS 已包含世界模块头部两处互相覆盖的 margin/padding 规则；最终生效规则在后段。此类死覆盖是回归风险，需在同一安全范围收敛。

## 目标几何契约

对根级世界、个人风评和势力条目统一：

```text
模块内容左缘 (16px)
├─ 24px 视觉节点 / relation slot
├─ 8px 间隔
└─ 标题文本轨道（标题、摘要均从此处开始）
```

- 条目节点左缘：模块内容左缘；不得再有透明、无边界的内部 padding 造成二次缩进。
- 标题文本轨道：`--pm-today-trend-relation-node-size + --pm-space-2`，即当前 24px 节点加 8px 间隔。
- 摘要文本轨道：与同一条目的标题文本轨道完全一致。
- 标题至摘要：通过容器 grid/flex `gap: --pm-space-2` 表达；摘要不再用 hero/brief 各自的 `margin-top` 制造不同节奏。
- 势力嵌套节点继续在其层级缩进后的“局部内容左缘”应用同一节点→标题/摘要关系，保留树形信息。

## 方案

### 1. 用 CSS Grid 建立轨道，不改渲染数据或行为

仅调整 `styles/today-trend.css`：

- 世界态势 hero/brief 改为显式三列 grid；其 header 跨全列，直接子摘要 `p` 位于第三列。
- 移除 world hero/brief 的透明内层 padding；以模块外层 `--pm-space-4` 提供唯一手机边距。
- 个人风评与势力图谱的 entry body 改为相同的三列 grid；摘要 `p` / `.pm-today-trend-faction-summary` 放入第三列，评分尺与势力详情保持跨全列，避免把可交互 meter 和资料表压入过窄文本列。
- world 条目、reputation/faction body 的 row gap 都使用 `--pm-space-2`；清除与此冲突的 hero/brief 摘要上 margin。
- 清理已被后续规则覆盖的 world module-head 历史 margin/padding 声明，仅保留最终唯一事实源；不改变最终视觉意图。

此方案不需要为纯布局引入新 DOM class、数据字段或私有 token；现有 relation slot、space 与外层 padding 已具备所需语义。为了一个对齐问题再造一套“内容轨道 token”，只会把简单规则伪装成架构，没必要。

### 2. 保留的视觉差异

- 世界 hero 与 brief 的摘要字号层级继续由现有私有 world token 控制；本次统一的是位置和节奏，不将主态势与次级简报强行排成同一信息权重。
- 势力的详情 definition list、关系评级尺以及树层级缩进保持原职责；它们不是摘要，不能被错误塞入标题文本列。
- 个人风评的交互 meter、极简模式 44px relation button、普通模式图标、菜单、ARIA、disabled/focus 和状态循环均不变。

## 修改范围与非目标

### 预计修改

- `styles/today-trend.css`
- `scripts/check-contracts.mjs`

### 非目标

- 不修改 `src/today-trend-*-view.js`，除非实施前证明现有 DOM 无法承载 grid；当前已确认 world、reputation、faction 都具备 header 与摘要/正文的可定位结构。
- 不改 store、schema、版本、持久化、生成 prompt、导入导出、标题 SVG 映射和任何业务 action。
- 不改模块总标题、全局内容区 padding、关系颜色、meter 选中态或世界条目文案。
- 不使用负 margin、`translateX`、补偿 padding 或缩放伪造对齐。

## 契约与验证

在 `scripts/check-contracts.mjs` 增加可机器检查：

1. world hero/brief 使用三列轨道，header 跨列，摘要位于文本列；透明条目 padding 为 `--pm-space-0`。
2. reputation/faction entry body 使用等价三列轨道；摘要分别位于第三列；rating/detail 保持跨列。
3. 三类条目统一使用 `--pm-today-trend-relation-node-size`、`--pm-space-2` 与 `minmax(0,1fr)`，不得重新引入裸间距、负 margin 或 transform 位移。
4. 势力树嵌套缩进规则仍存在；minimalUi 的 44px button slot、SVG 尺寸、ARIA/disabled 相关既有契约持续通过。
5. 删除或合并世界 module-head 的死覆盖后，最终 header 规则唯一且仍满足当前 CSS token 治理。

验证顺序：先运行相关静态契约与 `check:today-trend`，再执行 build、syntax、contracts、全量 check 和 `git diff --check`。人工宿主验证覆盖亮/暗、普通/极简、320px、长标题、根级与嵌套势力、键盘焦点和实际 44px 命中区。

## 风险与回滚

| 风险 | 控制措施 | 回滚边界 |
| --- | --- | --- |
| 摘要进入第三列后窄屏宽度不足 | 保留 `minmax(0,1fr)`、`overflow-wrap:anywhere`，在 320px 观察长标题和长摘要 | 仅回退本次轨道 CSS，不碰数据或渲染行为 |
| world 操作菜单使 header 高度不同 | header 跨列，摘要由统一 row gap 起排；不以绝对定位补偿 | 调整 header/grid 行规则，不改菜单 DOM/ARIA |
| nested faction 被误拉平 | 契约锁定既有 nested indent，人工检查 depth 1+ | 回退摘要 grid 列，不改变树缩进 |
| CSS 去重误改最终层叠 | 删除前逐条确认等价最终声明，并由契约验证 | 恢复单个被删除的历史规则；不恢复重复方案 |

## 设计自审

这套设计仅解决条目内部的内容轨道，不假装顺便重做全部今日风向版式。它能消除已证实的重复缩进和摘要错轨，但真实 SillyTavern 宿主尚未提供截图或浏览器测量证据；实施后的视觉验收不能用静态 CSS 通过来冒充。