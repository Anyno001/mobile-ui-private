## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 补充今日风向契约断言，固定导航图标一致性、关系色双主题定义与极简势力节点无外层底色的边界。  `#add-regression-contracts`
- [x] 让今日风向底部导航默认图标与返回桌面图标使用相同线宽与浅灰层级，保留当前激活项的主题色表达。  `#align-nav-icons`
- [x] 在极简势力图谱中显式覆盖普通模式节点底色，只保留 24px 可见关系圆及透明 44px 点击命中区。  `#fix-minimal-faction-node`
- [x] 用已确认的亮暗双主题、与主题蓝协调且保持图标对比度的五档关系色替换旧脏色。  `#refresh-relation-palette`
- [x] 运行构建、语法、今日风向和 CSS 契约检查、完整门禁及 diff 检查，并在亮暗、普通/极简、320px 宽度下完成视觉回归。  `#validate-and-review`
- [x] 记录并隔离当前工作树中既有的 .limcode 文档改动，确认目标 CSS、关系视图和契约脚本的基线。  `#verify-baseline`
<!-- LIMCODE_TODO_LIST_END -->

# 今日风向导航与关系状态视觉修正

## 计划来源

**来源：助手的直接需求（已确认）。**

- 底部导航图标默认态须与“返回桌面”图标完全一致；仅当前选中项使用主题强调色。
- “个人风评”与“势力图谱”的五档关系状态应替换为与主题蓝相协调、现代且清新的颜色，而不是机械套用与界面割裂的高饱和 iOS 五色。
- 极简模式的势力图谱须消除关系 SVG 外层误显的大圆背景；保留内部可见关系圆和 44px 的透明可点击命中区。

## 已核实的现状与问题定位

| 范围 | 已验证事实 | 处理结论 |
| --- | --- | --- |
| 底部导航 | `src/today-trend-view.js` 统一从 `icons.js` 渲染 SVG；`styles/today-trend.css` 中底部 tab 默认色已是 `--pm-color-text-placeholder`，与返回桌面相同，但额外把 tab SVG `stroke-width` 覆盖为 `1.7`，而返回桌面沿用通用 SVG 的 `2`。激活态已为 `--pm-color-accent`。 | 删除/撤销仅作用于 tab SVG 的线宽覆盖；不改变动作、ARIA、图标或激活态逻辑。 |
| 五档关系色 | `hostile/dislike/neutral/like/trust` 在今日风向 shell 的局部 token 中定义亮暗各一套值；普通与极简视图通过相同 token 消费。现有前景统一为 `--pm-color-on-dark`，图标 SVG 使用 `currentColor`。 | 仅替换局部 token 的亮暗值，保留五档枚举、数据模型、SVG、关系切换顺序与统一高对比前景。 |
| 极简势力节点 | 极简按钮设计为透明 44px 点击区，内部 `.pm-today-trend-relation-symbol` 是 24px 可见圆；但普通模式的势力节点选择器为更高特异性规则，写入了圆形 accent 背景，可能覆盖极简模式的透明外壳，导致 SVG 后出现大圆。 | 使用只限极简势力节点的、更高特异性覆盖，明确外壳透明、无边框/阴影；不可删掉内部 24px 状态圆或压缩 44px 触控命中区。 |

## 目标视觉契约

### 1. 导航

- 默认：底部导航和返回桌面都使用 `--pm-color-text-placeholder` 与同源 SVG 线宽（通用 `icons.js` 的 `stroke-width="2"`）。
- `aria-pressed="true"`：底部导航仅 SVG 使用 `--pm-color-accent`；不将未选中项或整个按钮改成主题色。
- hover/focus：继续遵循现有 secondary 色和 focus ring；不得降低图标按钮的紧凑 36px 命中区。

### 2. 五档关系色

采用“主题蓝为中轴、暖端表示负向、青绿表示高信任”的低饱和现代色，而非五个互相抢戏的糖果色；五档继续具备独立语义。

| 状态 | 亮色 token 值 | 暗色 token 值 | 设计角色 |
| --- | --- | --- | --- |
| hostile | `#C93545` | `#E04A5A` | 深玫红，明确敌意但不荧光 |
| dislike | `#B86430` | `#D4783E` | 暖铜色，位于负向与中性之间 |
| neutral | `#6B7B8A` | `#8A9AAB` | 冷灰蓝，融入蓝灰表面体系 |
| like | `#2E7BB5` | `#5A9FD4` | 亲和蓝，接近但不抢占 accent |
| trust | `#1F8C6E` | `#3AAB89` | 稳定青绿，表示最高正向关系 |

实施前以实际对比度计算复核五种背景与 `--pm-color-on-dark` 的 SVG 前景均满足非文字图标至少 3:1；任一档不达标时仅微调该档局部 token，不扩张全局色板、不拆分前景 token。

### 3. 极简势力节点

- 外层 `.pm-today-trend-faction-node`：透明、无边框、无阴影，保留 44px 最小命中区和键盘 focus-visible。
- 内层 `.pm-today-trend-relation-symbol`：保持 24px (`--pm-today-trend-relation-node-size`) 实心状态圆及 `currentColor` SVG。
- 普通模式仍保留原 24px 实心势力节点；极简修复不得反向污染普通模式、个人风评或世界态势节点。

## 实施步骤与依赖

### 阶段 0：基线与改动隔离

1. 在实现前记录 `git status --short`、目标文件 diff 与现有 `.limcode` 文档改动，明确其不属于本次 UI 改动，禁止覆盖或混入提交。
2. 读取当前 `styles/today-trend.css`、`src/icons.js`、`src/today-trend-view.js`、`src/today-trend-{faction,reputation,ui}.js` 和两类 checker 的实际版本；再次搜索所有目标 class、关系 token、内联样式和后置覆盖规则。
3. 建立亮/暗、普通/极简以及 320px 的验证矩阵；若后置样式或宿主规则能覆盖目标规则，先定位再修改选择器，不用 `!important` 掩盖优先级问题。

**阻塞条件：** 若工作树内出现 `styles/`、`src/` 或 `scripts/` 的非本次改动，先由助手确认如何隔离，不能把别人的变更一起交付。

### 阶段 1：导航图标一致性

1. 在 `styles/today-trend.css` 移除底部 tab SVG 专属的 `stroke-width:1.7` 覆盖，使其继承 `icons.js` 通用图标构造器的 `stroke-width="2"`。
2. 保留默认 placeholder 色、选中 SVG accent 色、hover/focus 的 secondary 色与背景反馈，不变更 tabs 的 DOM、`data-action`、`aria-pressed` 或点击路由。
3. 在 `scripts/check-today-trend.mjs` 增加可读的回归断言：tab SVG 不得重新覆盖线宽，默认色保持 placeholder，选中项保持 accent。

**完成标准：** 同一非激活线框图标在底部导航与返回桌面位置无颜色或笔画粗细差异；激活 tab 仍唯一以主题色提示。

### 阶段 2：关系色板更新

1. 仅在 `.pm-today-trend-shell` 及其暗色主题覆盖中替换五个 `--pm-today-trend-relation-*` 局部 token 为目标表中的值；保留 `--pm-today-trend-relation-foreground:var(--pm-color-on-dark)`。
2. 不改 `TODAY_TREND_RELATION_STATUSES` 枚举、存储 schema、生成提示词、状态切换逻辑、图标路径或普通/极简 DOM。
3. 对普通模式节点、极简关系圆、个人风评量表和势力量表逐档核验：状态色只出现在状态圆，量表的选中下划线仍使用主题 accent，不把状态颜色扩散到文本和页面主控件。
4. 在 `scripts/check-today-trend.mjs` 增加精确亮/暗 token 断言和前景消费断言；若可在现有 node 环境中稳定实现，加入对每档 RGB 与白色前景的最小 3:1 对比计算，避免以后把可见性退化成“看起来差不多”。

**完成标准：** 五档在亮暗主题均可区分、与蓝色主题和谐、SVG 清晰；普通与极简路径消费的是同一组语义 token。

### 阶段 3：极简势力节点外壳修复

1. 复现并确认普通势力节点规则的 selector specificity 高于通用极简透明按钮规则；不要凭肉眼猜 CSS 层叠。
2. 增加只命中 `.is-minimal-ui` 下势力图谱标题关系节点的覆盖规则，其 specificity 足以压过普通规则：外层按钮 `background:transparent`，并显式保持 `border:0`、`box-shadow:none`；不改变 44px 的 minimum hit target 与绝对定位锚点。
3. 保持 `.pm-today-trend-relation-symbol` 作为唯一可见的 24px 背景圆，继续按 hostile/dislike/neutral/like/trust token 着色并包含 SVG。
4. 在 `scripts/check-today-trend.mjs` 加入负例：极简势力外层节点不得重新获得 accent/状态背景；正例：透明 44px 命中区、24px 内层状态圆、忙碌禁用和 focus-visible 仍存在。必要时在 `scripts/check-contracts.mjs` 以解析后的 selector/declaration 复核，避免仅凭字符串位置通过。

**完成标准：** 极简势力图谱视觉上只见一个 24px 可点击关系圆；实际点击区域仍为 44px，且 SVG、键盘焦点、禁用态完整。

### 阶段 4：验证、回归与交付

1. 按顺序执行：`npm.cmd run build` → `npm.cmd run check:syntax` → `npm.cmd run check:today-trend` → `npm.cmd run check:contracts` → `npm.cmd run check` → `git diff --check`。每条命令独立执行并记录 exit code；全量门禁失败时先隔离是本轮失败还是既有基线债务。
2. 人工回归矩阵：
   - 亮色/暗色：返回桌面与所有未选中 tab 的色与笔画一致；每个激活 tab 使用 accent。
   - 普通模式：个人风评和势力图谱的五档圆、SVG、量表和文本布局正确。
   - 极简模式：个人风评/势力图谱只显示 24px 状态圆，势力节点不再出现 SVG 外层 44px 大圆；点按、键盘 focus、生成忙碌 disabled 均正确。
   - 320px：五档量表与势力标题可用、无横向溢出，触控命中区未缩小。
3. 检查 diff 只含 `styles/today-trend.css`、针对性 checker 修改及本计划/进度同步；不得包含编译产物 `index.js`，除非仓库既有发布流程明确要求将其作为可审查构建输出。

## 风险、边界与回滚

| 风险 | 控制措施 | 回滚点 |
| --- | --- | --- |
| 用“清新色”破坏主题一致性或 SVG 对比度 | 锁定本计划色板、亮暗成对、实测图标对比；不使用全局主题 token 或无语义新色 | 恢复五个今日风向局部 token 的前一组值，不动数据或行为 |
| 极简修复反向影响普通势力节点 | 覆盖规则必须以 `.is-minimal-ui` 为作用域，补普通模式负例断言 | 单独删除极简 override，普通模式规则保持原样 |
| 用 `!important` 压优先级造成后续主题不可控 | 先通过语义限定选择器解决 specificity；除已有 home 规则外不新增 `!important` | 仅回退该覆盖规则，不影响关系图标渲染 |
| CSS 构建/契约检查遗漏退化 | 增加正负例断言并执行全量门禁；人工验证四种视图/主题组合 | 任何门禁失败不得交付，先按失败归属修正 |
| 误混工作树既有文档改动 | 阶段 0 记录并隔离 `.limcode` 现有改动；提交前复核路径与 diff | 不使用 reset；只逆向撤销本轮可识别 hunk |

## 非目标

- 不新增或迁移持久化字段，不提升今日风向 schema 版本。
- 不替换 SVG 图形、不调整关系状态枚举或循环顺序。
- 不重构今日风向布局、导航结构、主题系统或组件 token 体系。
- 不把关系状态色用作普通文本、按钮主色或页面装饰。

## 验收清单

- [ ] 非选中底部导航 SVG 与返回桌面 SVG 使用相同默认浅灰与笔画粗细。
- [ ] 选中底部导航 SVG 仍使用 `--pm-color-accent`，其他导航项不被误染色。
- [ ] 五档关系色在亮暗主题均为计划所列色板，SVG 前景达到至少 3:1 对比。
- [ ] 普通个人风评、普通势力图谱与极简状态圆均消费相同的五档关系 token。
- [ ] 极简势力图谱不再显示 SVG 后的外层大圆；透明 44px 点击区、24px 可见圆、focus 与 disabled 语义仍完整。
- [ ] `build`、`check:syntax`、`check:today-trend`、`check:contracts`、`check` 和 `git diff --check` 均获得可核验结果；任何既有失败单独列明。
