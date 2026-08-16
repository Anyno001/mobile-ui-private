<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/today-trend-community-ui-redesign.md","contentHash":"sha256:569e510df127c989a5f9ce0a5f0abe8b97e850c4ed63263c5e656848a0ee22bf"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 盘点关系节点、说明排版和子社区场景色的实际选择器、调用链、治理登记及现有断言，冻结最小改动范围。  `#baseline-scope-audit`
- [x] 仅将当前子社区内容区错误使用的全局 accent 改为 scene-accent，保留桌面与通用入口的全局主题边界。  `#community-scene-accent`
- [x] 补齐今日风向、子社区和公共 CSS 契约，构建并执行专项、全量、差异及视觉回归，区分既有基线失败。  `#contracts-build-validation`
- [x] 分离简易关系按钮的 44px 命中区与 24px 可见实心关系圆，复用 SVG helper 并保留五档动作、ARIA、禁用和状态循环。  `#trend-relation-symbol`
- [x] 仅在 minimalUi 下收紧标题到说明间距、放宽说明行高，并使势力详情短标签随主题 accent、正文保持可读。  `#trend-spacing-labels`
<!-- LIMCODE_TODO_LIST_END -->

# 今日风向简易模式与子社区局部主题色视觉收敛

## 1. 计划来源与已确认边界

**来源设计：** `.limcode/design/today-trend-community-ui-redesign.md`

本计划落实助手针对上一轮 UI 的修正反馈。核心边界已经确认：

- 不回退 hostile / dislike / neutral / like / trust 五档关系语义色；回退的仅是**可见圆形尺寸**。
- 简易模式关系节点采用“44px 透明命中区 + 24px 实心可见圆 + 高对比 SVG 前景”；24px 尺寸与世界态势 signal marker 共享来源。
- 仅 `.pm-today-trend-content.is-minimal-ui` 受今日风向视觉变更影响；普通模式保留现状。
- 标题至首段说明/首个信息块从 12px 收紧为 `--pm-space-2`，独立条目间距仍为 `--pm-space-3`；多行说明改用 `--pm-line-height-loose`。
- 势力图谱所有详情 `<dt>`（关系评价、外部关联、数据化诉求等）跟随手机主题 accent；`<dd>` 和长文本维持可读性优先的文本色。
- 子社区“当前社区色”唯一指活动 `.pm-scene-shell` 的 `--scene-accent`，不得反写或污染全局 `--pm-color-accent`。

不处理日历、生成/同步业务语义、关系状态循环、存储 schema、主题存储或既有全量门禁债务。

## 2. 当前证据与问题定位

| 现状 | 证据 | 后果 |
| --- | --- | --- |
| minimalUi 对四类主内容设置 12px 间距 | `styles/today-trend.css:236-238` | 标题与说明视觉脱节 |
| 大部分说明仍是 1.5 行高 | `styles/today-trend.css:186,210,280-292,305-307` | 多行说明内部过密 |
| 关系按钮以负 margin、padding 和 background-clip 同时伪造 44px 命中与 24px 圆 | `styles/today-trend.css:195` | 尺寸职责耦合，布局和视觉难维护 |
| 五档状态已有语义色映射 | `styles/today-trend.css:239-243` | 必须重新分配配色职责，不能删除状态色 |
| 世界态势可见圆使用 24px 私有尺寸 | `src/today-trend-world-view.js:33`、`styles/today-trend.css:158-160,302` | 关系圆需共享其尺寸来源 |
| 势力详情标签统一 tertiary 色 | `src/today-trend-faction-view.js:18-19`、`styles/today-trend.css:212-217` | 关系评价/诉求等短标签未跟随主题 |
| 当前子社区根已写入场景色 | `src/interactive-scene-views.js:225`、`src/interactive-scene-phone.js:321,325-334` | CSS 应复用现有 `--scene-accent`，不另建色源 |

## 3. 实施任务与依赖

### 3.A 预实施审计与基线留档

**依赖：** 无。后续全部任务以此为前提。

1. 精确搜索并阅读以下范围：
   - `src/today-trend-ui.js`、`src/today-trend-reputation-view.js`、`src/today-trend-faction-view.js`、`src/icons.js` 的关系 SVG 与渲染调用。
   - `styles/today-trend.css` 中 relationship node、world signal marker、minimalUi、320px 和 reduced-motion 规则。
   - `scripts/check-today-trend.mjs`、`scripts/check-contracts.mjs` 的现有 relation/status/spacing 断言。
   - `.pm-scene-shell` 子树中 `--pm-color-accent` 的全部消费，以及 `scripts/check-interactive.mjs` 的 scene accent 覆盖。
2. 将 community 命中项分为“活动子社区内容”与“桌面/通用入口”；后者列为显式不修改项，禁止全局替换。
3. 在亮色、暗色、两种不同 scene accent 和 320px 下记录改前 DOM/截图，确认空间与颜色问题真实存在。
4. 读取 `scripts/css-governance-registry.json` 中 today-trend 私有 token、`--scene-accent` root/owner 和 inline allowed writes，确定是否真的需要更新登记。

**验收：** 改动文件清单、未改动选择器清单与全部现有契约位置明确；没有因猜测加入 scene accent 写入或主题状态。

### 3.B 重构简易关系节点的结构与尺寸

**依赖：** 3.A 完成；先建立共享尺寸来源，后删旧补丁。

1. 在 `src/today-trend-ui.js` 提取展示型 `trendRelationSymbol(status)` helper，复用 `TODAY_TREND_RELATION_ICON_PATHS` 并输出 `aria-hidden="true"` 的内层 symbol 和 `currentColor` SVG。
2. 在 `src/today-trend-reputation-view.js` 与 `src/today-trend-faction-view.js` 用该 helper 替换重复 SVG 模板；不得改变按钮的 `data-action`、ID、`data-status`、`aria-label`、`disabled` 或普通模式 `<span>` 的语义边界。
3. 在 `.pm-today-trend-shell` 声明共同私有 token `--pm-today-trend-relation-node-size:var(--pm-space-5)`；将 world signal marker 与新 relation symbol 同时改为消费该 token，并在治理登记中记录 owner、根选择器、用途和移除条件。
4. 仅 minimalUi 下将 button 设为 44px 透明命中容器；内层 symbol 以 grid 居中并承载 24px 实心圆。删除旧的负 margin、补偿 padding 和 `background-clip:content-box`。
5. 五档配色必须使用以下已登记 token 配对：
   - hostile：`danger` 圆底 + `on-danger` SVG；
   - dislike：`warning` 圆底 + `on-warning` SVG；
   - neutral：`surface-control` 圆底 + `text-primary` SVG；
   - like：`accent` 圆底 + `on-accent` SVG；
   - trust：`success` 圆底 + `on-success` SVG。
6. `focus-visible` 继续使用 focus-ring；disabled 保持最后层叠并禁用交互；hover/active 不得抹除五档圆底或 SVG 对比。

**验收：** 五档不退化为统一色；可见圆为 24px 且与 world signal marker 同源；按钮仍为 44px；无负 margin、背景裁剪、裸色、重复 ARIA 或第二个交互节点。

### 3.C 收紧说明节奏并调整势力标签层级

**依赖：** 可与 3.B 并行，但共同 CSS 修改必须串行合并并做选择器复查。

1. 仅在 `.pm-today-trend-content.is-minimal-ui` 中，把 world hero/brief 的标题到说明间距调整为 `--pm-space-2`。
2. 将 reputation entry、faction card、event body 的 minimal 主层级 `row-gap` 调整为 `--pm-space-2`；不修改 reputation list、world signals、event list、树兄弟节点的 `--pm-space-3`。
3. 为 world/reputation/faction/event 的说明性正文和势力 `<dd>` 增加明确的 minimalUi `--pm-line-height-loose` 覆盖；标题、仪表、按钮、楼层与 `<dt>` 维持既有紧凑行高。
4. 保留 minimalUi event facts 的零起始偏移，避免历史负偏移冲抵新的 8px 节奏。
5. 仅 minimalUi 下把 `.pm-today-trend-faction-detail-row dt` 设为 `--pm-color-accent`；维持 `<dd>`、摘要和长说明的 secondary 色，确保长文本不被错误染色。
6. 在自定义主题下检查短标签对比度；若无法达到可读性要求，采用“primary 文本 + accent 前置标记”的降级方案并在实施前反馈，不得静默交付低对比主题文字。

**验收：** 标题到说明明显收紧且多行说明更舒展；独立卡片距离没有被误缩；势力短标签随主题、正文不失可读性；普通模式的对应计算样式不变。

### 3.D 令子社区内容继承当前场景色

**依赖：** 3.A 的分类结论；默认只修改 CSS，不动 JavaScript 写入链。

1. 审计 `styles/community.css` 中活动 `.pm-scene-shell` 内容区域的 global accent 消费，逐项将确认属于社区局部强调的属性改为 `--scene-accent`。
2. 覆盖范围限于社区内主要操作、局部选中态、作者/标签、场景内图标及其必要的 hover/active 状态；基础色、border、danger、focus-ring 继续消费公共语义 token。
3. 保持 `.pm-desktop-app-icon`、`.pm-quick-reply-actions`、`.pm-desktop-community-dock` 等无活动社区上下文的桌面/通用入口为 `--pm-color-accent`，并以反向测试保护。
4. 只有证明当前场景根未收到正确 `--scene-accent` 时，才最小修改 `src/interactive-scene-views.js` 或 `src/interactive-scene-phone.js`；此时同步登记 inline write owner 并为场景切换增加契约。没有证据不得改。

**验收：** 切换两个 scene accent 后，当前子社区内容随根变量更新；全局手机主题变量不被改写；桌面/快速回复等通用入口仍跟随全局主题。

### 3.E 补机器契约、构建与发布前验证

**依赖：** 3.B、3.C、3.D 全部完成。

1. 更新 `scripts/check-today-trend.mjs`：
   - 锁定 minimalUi 的 `--pm-space-2` / `--pm-line-height-loose` 与普通模式反向边界；
   - 断言 44px hit target、24px shared visual token、inner symbol 和五档圆底/SVG 前景；
   - 保留 action/ARIA/disabled、状态循环、普通模式隔离和 320px 断言；
   - 禁止旧 relation 负 margin、`background-clip` 方案复现。
2. 更新 `scripts/check-interactive.mjs`：用至少两个 scene accent 验证 `.pm-scene-shell` 局部变量、切换更新和全局主题隔离；断言桌面/通用入口不被误改为局部色。
3. 更新 `scripts/check-contracts.mjs`：锁定共享私有 token 的登记/消费、minimalUi 作用域、禁止模式和 community 局部色边界。若 registry 变更，验证 owner/根选择器不被无边界扩大。
4. 运行 `npm run build` 更新 `index.js`，再执行：
   - `npm run check:syntax`
   - `npm run check:today-trend`
   - `npm run check:interactive`
   - `npm run check:contracts`
   - `npm run check`
   - `git diff --check`
5. 对 `check:behavior`、`check:permissions`、`check:contracts` 的任何失败与隔离 HEAD 对照；本轮新增失败必须修复，不能混入既有债务。
6. 做浏览器人工回归：亮/暗/自定义主题、320px、五档连续切换、Space/Enter、focus-visible、disabled、世界 marker 同尺寸、两种 scene accent 切换、普通今日风向和社区数据编辑保存。

**验收：** 新增专项断言全部通过；构建产物可复现；`git diff --check` 为零错误；全量失败如有必须逐项标明是本次引入或 HEAD 已存在，并提供对照证据。

## 4. 回滚策略

本轮不涉及持久化迁移，可拆分回滚：

1. **今日风向：** 回退 relation symbol helper、两处视图调用、minimal CSS 和对应契约；关系状态数据和 action 分发不变，旧结构可以继续渲染。
2. **子社区：** 回退 `styles/community.css` 的局部 `--scene-accent` 消费和互动契约；不触碰 scene/preset 存储、主题存储或全局变量。
3. 若主题色短标签在自定义主题不满足对比度，先回滚仅 `<dt>` 的颜色覆盖，保留间距和关系节点改造，避免为单一主题问题撤掉可访问交互修复。

## 5. 交付完成定义

- 简易模式标题至说明为 8px、说明行距为 1.75，独立条目仍保留 12px 节奏。
- 五档关系状态色仍完整存在；24px 实心可见圆与世界态势同源；SVG 前景具备正确 on-color 对比；44px 命中区、键盘、焦点和禁用均保持。
- 势力详情的短标签随主题色，长文本保持可读。
- 当前子社区随自身 `--scene-accent` 变化，且不污染全局主题或无场景上下文的入口。
- 自动契约、构建、专项检查、差异检查和人工亮暗/窄屏/交互回归均有明确结果与失败归属。
