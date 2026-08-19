<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/community-today-trend-visual-harmony.md","contentHash":"sha256:2160b7fead243602aaeb3e00bcffbff95b9672958315cf8760b7cf09748db815"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 独立验收已完成；助手明确接受逐动作契约与非目标边界证据的已知 major 延后至下次补齐，并授权当前专项提交与推送。  `#community-today-trend-visual-acceptance`
- [x] 将 feed 发布、live 弹幕和评论回复的场景内提交按钮收敛到 --scene-accent，不影响全局发送入口。  `#community-today-trend-visual-community-send`
- [ ] 补齐社区三类发送 data-action 的逐动作契约、关系视觉污染负例，以及非目标模型/store/version/prompt/persistence 的完整 diff 边界证据。  `#community-today-trend-visual-contract-boundary-followup`
- [x] 先扩展 CSS/token 契约，锁定三类社区提交动作、五档关系视觉色、普通/极简几何与禁止泄漏范围。  `#community-today-trend-visual-contracts`
- [x] 补齐社区发送控件、--scene-accent 运行时写入、全部 .pm-scene-primary 消费点及既有视觉设计的精确证据，确认改动边界。  `#community-today-trend-visual-recon`
- [x] 登记并应用五档低饱和局部关系色，保证 SVG 的 currentColor 前景统一为白色且不影响 meter。  `#community-today-trend-visual-relation-colors`
- [x] 统一个人风评与势力图谱在普通/极简模式的 24px 可视圆、18px SVG、8px 标题与说明节奏，并保留 44px 触控命中区。  `#community-today-trend-visual-relation-layout`
- [x] 执行构建、语法、专项/全量契约、diff 检查及可行的窄屏与可访问性回归；记录无法运行的宿主验证。  `#community-today-trend-visual-validation`
<!-- LIMCODE_TODO_LIST_END -->

# 社区发送键与今日态势视觉收敛

## 计划来源

- **来源设计**：[`community-today-trend-visual-harmony.md`](../design/community-today-trend-visual-harmony.md)
- **计划状态**：待助手审查、确认后实施。不得在本计划确认前修改源码、样式、构建产物或数据。
- **设计已知前提**：黑色 SVG 的已证实 CSS 路径是极简模式的 `dislike`/`neutral` 前景分别引用 `--pm-color-on-warning` 与 `--pm-color-text-primary`；社区 `--scene-accent` 与 `.pm-scene-primary` 的精确 DOM/CSS/运行时写入锚点尚需在实施前补齐。

## 目标与边界

### 交付目标

1. 仅在社区场景根内，让 **feed 发布、live 弹幕发送、帖子评论回复** 三类提交动作消费当前 `--scene-accent`，不再以全局 `--pm-color-accent` 作为其背景/边框色来源。
2. 使个人风评、势力图谱的关系圆与世界态势 signal marker 在视觉上采用同一几何契约：左缘、24px 可见圆槽位、18px SVG、标题前 `var(--pm-space-2)`（8px）间距；标题与说明正文的间距也固定为 8px。
3. 为 hostile/dislike/neutral/like/trust 建立低饱和、可辨识的**今日态势局部语义色**；普通与极简模式中的关系 SVG 都以白色 `currentColor` 呈现，底色与前景满足非文字对比度不低于 3:1。
4. 保留关系状态枚举、数据、store、循环操作、meter、ARIA、disabled/focus 行为，以及极简模式 44px 最小触控命中区和 320px 可用性。

### 明确不做

- 不修改 today-trend 数据模型、持久化、版本、prompt、导入导出、备份、标题图标映射或关系 SVG path。
- 不新增行内视觉颜色、第三方图标或全局主题 token；不把状态色写入数据。
- 不影响桌面入口、普通手机聊天发送键、quick reply、全局 `--pm-color-accent`，也不把 meter 选择控件误当作关系圆。

## 现状证据、缺口与实施门槛

| 项目 | 已确认事实 | 实施前必须复核的精确证据 |
| --- | --- | --- |
| 关系视觉 | `styles/today-trend.css` 的极简关系圆按五档使用 danger/warning/surface-control/accent/success；warning/neutral 前景可产生黑色 SVG。世界 signal marker 使用 24px relation token 与 18px SVG。 | reputation/faction 的完整 DOM、对应布局选择器、overflow 约束、320px 规则及普通模式实际前景继承链。 |
| 社区发送 | 设计侦察认为 feed 发布和 live 弹幕复用 `.pm-scene-primary`，并且场景根存在 `--scene-accent`。 | `.pm-scene-primary` 的所有定义/覆盖、评论回复 DOM/class、`--scene-accent` preset/custom-accent 写入和浅色前景保护链。 |
| token 治理 | UI 改动必须只用登记过的 `--pm-*` token；组件私有 token 在组件根定义并登记。 | `docs/CSS-TOKENS.md` 后半部分的私有 token 登记格式、CSS registry 与 `scripts/check-contracts.mjs` 的现有断言锚点。 |

若 `.pm-scene-primary` 同时被非社区入口消费，不能粗暴改写其全局定义；必须建立限定在场景 root 内的选择器或更精确的发送动作 class。否则所谓“修主题色”会把无关入口拖下水，漏洞明显得像是故意排给事故看的。

## 实施顺序与任务拆解

### 1. 完成侦察闭环并冻结选择器边界

**文件/范围**：`styles/community.css`、`src/interactive-scene-views.js`、必要时 `src/interactive-scene-phone.js`；`src/today-trend-ui.js`、`src/today-trend-reputation-view.js`、`src/today-trend-faction-view.js`、`styles/today-trend.css`；历史设计/计划文档仅作冲突检查。

1. 搜索并精读 `--scene-accent` 的定义、运行时写入、`.pm-scene-primary` 的定义和所有消费者；逐项确认 feed 发布、live 弹幕、评论回复各自 DOM 及提交按钮 class。
2. 读取个人风评/势力图谱的完整渲染结构，区分 relation mark/node、44px 极简 button 和 meter；搜索其调用方，确认不改变 action、data attribute、ARIA 或 disabled 逻辑。
3. 读取 today-trend 布局的 reputation/faction body、entry/card、媒体查询和 overflow；确认 44px button 可采用“24px slot 内绝对定位、可见圆右缘与槽位对齐”的实现而不裁剪或覆盖标题。
4. 读取旧版社区/态势设计，列出与来源设计的冲突；新来源设计优先，旧文档不能悄悄复活已否决的布局或色彩规则。

**完成条件**：输出三类提交动作的精确 class/选择器清单、scene accent 写入链、relation DOM 结构、所有相关覆盖规则与契约测试落点；发现未受控的浅色 custom accent 或 overflow 裁剪时，先调整设计实现路径再编码。

### 2. 先写可机器验证的契约

**文件**：`scripts/check-contracts.mjs`，以及仅在已有专项检查存在对应断言时的 `scripts/check-interactive-scene.mjs` / `scripts/check-today-trend.mjs`；CSS token registry 相关文件。

1. 为三类社区提交动作建立静态正例：限定的社区选择器/结构存在、颜色来源为 `--scene-accent`、前景/disabled/focus 仍来自合法 token。
2. 建立负例：场景发送规则不得命中桌面、普通聊天、quick reply；不得将全局 `--pm-color-accent` 重新作为这三类提交动作的视觉来源。
3. 断言五档关系 visual 的局部 token 完整、普通与极简均引用同一状态映射、SVG 用 `currentColor`，且 relation visual 不再使用 `--pm-color-on-warning` 或 `--pm-color-text-primary` 作为状态前景；meter 不得进入该选择器。
4. 断言 relation slot=24px、SVG=`--pm-size-icon-md`、标题 gap 和标题到说明 gap 均为 `--pm-space-2`，并保留极简 button 的 44px 触控尺寸。
5. 将新增局部 token 定义、使用、文档登记纳入现有 CSS registry 约束。断言以本模块真实 fixture/选择器为准，不能把其他聊天模块的配置偷塞进来制造假失败。

**完成条件**：契约能在改动前以预期失败或缺失定位保护目标；不以脆弱的大段文本匹配代替组件级选择器/变量断言。

### 3. 收敛社区提交按钮的场景主题色

**文件**：以侦察结果为准，预计为 `src/interactive-scene-views.js` 与 `styles/community.css`。

1. 若三类按钮已经有共同且只在社区 root 出现的语义 class，复用该 class；否则在三处提交动作上补最小的共享 class，禁止改业务 submit handler。
2. 在场景 root 限定的 CSS 中让背景和必要边框消费 `--scene-accent`；前景使用已登记的深色表面前景 token，hover/active 使用已有状态 token 或已有 scene-derived 规则，disabled 使用 `--pm-opacity-disabled`，focus-visible 保留现有全局 focus-ring 语义。
3. 不改 `--scene-accent` 的运行时数据传递；若 custom accent 允许导致白色前景对比失败，只在既有 accent 规范化链中处理可访问前景，不在按钮上堆条件颜色补丁。

**完成条件**：三类社区提交按钮随场景 preset/custom accent 同步变化；其他全局发送入口的 DOM、class 及视觉 token 均不变。

### 4. 统一关系节点的布局、层级和触控几何

**文件**：`src/today-trend-reputation-view.js`、`src/today-trend-faction-view.js`、`styles/today-trend.css`。

1. 在关系列表/图谱条目的标题行建立显式 `[24px relation slot] → 8px → [title]` 布局；普通模式直接在 slot 呈现 24px relation visual 和 18px SVG。
2. 极简模式保留现有 44px button/action/ARIA/data-status/disabled；button 在 24px slot 内绝对定位并向左扩展，按钮内的可见圆仍是 24px，右缘与 slot 对齐。不要把 44px button 当作 flex item，否则标题列必然右移。
3. 去除仅造成起始列漂移的 entry/card 内层 padding，保留模块外层保护性 padding；若嵌套势力的 depth 缩进是有意信息层级，必须保留并只消除无意义的重复内缩。
4. 统一 body 为显式列布局，说明文本 `margin: 0`，标题到说明为 `gap: var(--pm-space-2)`；faction detail/rating 的分层间距仍为 8px。
5. 在 320px 媒体查询检查标题换行、嵌套节点和 meter；确认 relation button overlay 未遮挡标题、未被 overflow 裁剪且可被点击。

**完成条件**：普通/极简的可见圆起始列与世界 marker 对齐，标题/说明节奏一致；最小模式的触控与键盘语义未退化。

### 5. 登记并应用柔和的五档局部关系色

**文件**：`styles/today-trend.css`、`docs/CSS-TOKENS.md`、CSS registry/contract 文件。

1. 在 `.pm-today-trend-shell` 定义并登记 feature-scoped 的 hostile/dislike/neutral/like/trust 表面色及统一白色前景 token；每项亮/暗模式值按 token 文档规则成对提供。
2. 色彩方向固定为克制莓红、深琥珀、柔和石板灰、低饱和雾蓝、深青玉绿；最终色值必须经过白色 SVG 非文字对比度 ≥3:1 的计算/验证，不能凭“看起来不刺眼”蒙混过关。
3. relation mark/node 的普通与极简可见圆都只从该映射消费背景和白色 `currentColor` 前景；SVG path/stroke 维持 `currentColor`，不重绘 SVG。
4. 排除 reputation/faction meter 的选中态，使其继续遵循既有 accent 语义；禁止用 relation 状态色污染其 radio/control 状态。

**完成条件**：五种状态在普通和极简下均是白色 SVG、低饱和且可区分；任何模式不再出现 warning/neutral 导致的黑线 SVG。

### 6. 构建、回归、验收与可回滚交付

1. 分别执行：`npm.cmd run build`、`npm.cmd run check:syntax`、`npm.cmd run check:interactive`、`npm.cmd run check:today-trend`、`npm.cmd run check:contracts`、`npm.cmd run check`、`git diff --check`；再检查 `git diff --cached --check`（若有暂存内容）。失败先定位实现、断言、构建还是环境归属，不能重复刷同一个失败命令假装在解决问题。
2. 人工/宿主可用时，验证亮/暗、场景 preset/custom accent、三类提交、普通/极简、disabled/focus-visible、320px 窄屏、44px 命中区与关系状态循环；宿主不可用时如实作为验收 minor，不能伪造视觉结论。
3. 代码模式正式完成前调用独立 Acceptance Expert；出现 blocking/major 必须修复并复验，最多八轮。提交、推送 `main` 均需助手单独明确授权。

## 风险、阻塞与回滚

| 风险 | 控制与回滚 |
| --- | --- |
| `.pm-scene-primary` 有跨场景消费者 | 先搜索全量消费者；采用 scene-root 限定或专用提交 class。若泄漏，回滚限定 CSS/新增 class，不碰 scene accent 数据链。 |
| custom scene accent 过浅 | 复用/补强既有 contrast 规范化链，验证前景；不能在每个按钮堆硬编码兜底。若无法保证，暂不将该自定义色用于提交前景。 |
| 44px overlay 截断或挡住内容 | 实施前检查 overflow 与 320px；发生问题时回滚为不改变 action/ARIA 的 slot 内定位方案调整，不回滚数据/status。 |
| 新五档颜色可读性不足 | 色值只位于 feature token；回滚只改 token 值，结构、状态枚举和持久化均不动。 |
| 旧设计相互矛盾 | 以本计划来源设计为准；发现影响行为或契约的冲突须停下请求助手裁决。 |

## 验收清单

- [ ] 三种且仅三种社区提交动作使用 `--scene-accent`；桌面、普通聊天与 quick reply 未受影响。
- [ ] 个人风评、势力图谱、世界 marker 的可见关系圆基线为 24px，SVG 为 18px，标题 gap 为 8px。
- [ ] 标题至说明、faction detail/rating 的布局间距可由 `--pm-space-2` 追溯；无临时裸值补偿。
- [ ] 普通/极简五档关系 SVG 都是白色 `currentColor`，五种底色与白色前景非文字对比度 ≥3:1，meter 未被误染色。
- [ ] 极简按钮仍满足 44px 命中区，ARIA、disabled、focus 和状态循环无回归；320px 下无裁剪、遮挡或不可点击。
- [ ] 所有规定构建/契约/diff 门禁通过；不可执行的宿主视觉/a11y 检查明确记录。
- [ ] 独立验收无 blocking/major；提交或推送只在助手明确授权后执行。
