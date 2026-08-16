# 今日风向简易模式与子社区局部主题色视觉收敛

## 1. 本次修订结论

上一版把“圆大小回退”和“颜色重新设计”错误地写成了把关系节点退回中性圆底、仅让 SVG 带色。那等于撤掉已经落地的五档关系色，不是助手要求。这个方向作废。

本版的约束是：

1. **不回退五档关系语义色。** hostile / dislike / neutral / like / trust 继续具备稳定、可区分的状态表达；不退回所有节点统一蓝色，也不退回所有节点统一中性底。
2. **只回退可见圆的几何尺寸。** 关系节点的可见圆回到并共享世界态势 signal marker 的尺寸来源（当前为 `--pm-space-5`，即 24px）。
3. **重新分配颜色职责。** 可见圆承载五档关系背景色，SVG 使用对应的 `on-*` 前景色以获得对比；neutral 使用 `surface-control` 圆底和 `text-primary` SVG。不能让彩色圆底再叠加同色 SVG，那种低对比组合只会显脏。
4. **44px 只保留为透明点击命中区。** 它不是可见圆，不应再参与圆形背景、圆角、背景裁剪或布局挤压。视觉大小与触控大小必须分离，否则每改一次尺寸都要靠负 margin 善后，实在是低级债务。
5. 今日风向仍严格限制在 `.pm-today-trend-content.is-minimal-ui`；子社区仍从当前 `.pm-scene-shell` 的 `--scene-accent` 取色，绝不覆盖全局 `--pm-color-accent`。

## 2. 已验证现状

- `styles/today-trend.css:195` 目前将简易关系按钮扩成 44px，并通过 `margin:calc(... / -2)`、`padding`、`background-clip:content-box` 强行压回 24px 视觉。可见范围、命中范围与布局范围耦合，是本轮要移除的结构问题。
- `styles/today-trend.css:239-243` 已有五档语义映射：danger / warning / text-secondary / accent / success。保留这个状态模型，调整的是颜色如何落到圆底与 SVG，不是删除状态。
- 世界态势 signal marker 在 `src/today-trend-world-view.js:33` 渲染，并在 `styles/today-trend.css:158-160,302` 使用 24px 私有尺寸 token。
- 个人风评和势力图谱节点分别由 `src/today-trend-reputation-view.js:10-12`、`src/today-trend-faction-view.js:8-11` 输出；二者都有 `data-status`、操作 ID、ARIA 和 disabled 契约，均不得改变。
- 势力详情的“关系评价”“外部关联”及数据驱动标签均是 `src/today-trend-faction-view.js:18-19` 的 `<dt>`，当前统一使用 tertiary 色（`styles/today-trend.css:212-217`）。
- 当前子社区根在 `src/interactive-scene-views.js:225` 写入 `--scene-accent`，切换时由 `src/interactive-scene-phone.js:321,325-334` 更新；`styles/community.css` 已有局部消费该变量的成熟路径。

## 3. 目标视觉与实现约束

### 3.1 标题、说明与阅读节奏

上一轮把四类标题到说明统一为 12px，造成块间疏离；说明仍为 1.5 行高，又让块内阅读拥挤。调整为两层节奏：

| 关系 | 目标 |
| --- | --- |
| 条目标题 → 首段说明 / 首个信息块 | `--pm-space-2`（8px） |
| 相邻独立条目 / 卡片 | 保留 `--pm-space-3`（12px） |
| 多行说明与详情值 | `--pm-line-height-loose`（1.75） |
| 标题、楼层、仪表、`<dt>`、按钮 | 维持既有 `tight` / `control` 行高 |

仅在 minimalUi 下覆写：world hero/brief、reputation entry、faction card 与 event body 的主层级间距；列表、树兄弟节点和卡片之间不缩小。事件 facts 的 minimal 负起始偏移继续归零。

### 3.2 关系节点：回退圆大小，不回退颜色

#### DOM

在 `src/today-trend-ui.js` 增加仅作展示的 `trendRelationSymbol(status)`，复用既有 `TODAY_TREND_RELATION_ICON_PATHS`，输出一个 `aria-hidden="true"` 的内层 symbol 和 SVG。

个人风评、势力图谱的 minimal 按钮继续是唯一交互元素，必须原样保留：

- `data-action`
- circle/faction ID
- `data-status`
- 当前状态的 `aria-label`
- `disabled`
- 既有焦点恢复与五档循环

内层 symbol 不可点击、不重复声明可访问名称。普通模式 DOM 与样式不变。

#### 尺寸

- 在 `.pm-today-trend-shell` 定义并登记一个共同私有尺寸 token，例如 `--pm-today-trend-relation-node-size:var(--pm-space-5)`。
- 世界态势 `.pm-today-trend-world-signal-marker` 和 relationship symbol 一起消费它，确保可见实心圆始终同为 24px。
- minimal button 继续提供 `min-width/min-height:var(--pm-size-control-default)` 的透明命中区；不再有 `margin:calc(... / -2)`、`padding:calc(...)`、`background-clip:content-box`。
- 内层 symbol 以 grid 居中；必要的行内布局只由 flex/grid 处理，不用 transform 或负 margin 填坑。

#### 五档实心圆 / SVG 颜色设计

| 状态 | 实心圆背景 | SVG 前景 | 语义 |
| --- | --- | --- | --- |
| hostile | `--pm-color-danger` | `--pm-color-on-danger` | 敌对 |
| dislike | `--pm-color-warning` | `--pm-color-on-warning` | 疏离 / 不喜 |
| neutral | `--pm-color-surface-control` | `--pm-color-text-primary` | 中性 |
| like | `--pm-color-accent` | `--pm-color-on-accent` | 喜爱 |
| trust | `--pm-color-success` | `--pm-color-on-success` | 信任 |

这不是颜色回退：五档状态从“中性圆底 + 状态 SVG 色”重设计为“状态实心圆 + 高对比 SVG 前景”。SVG 保持 `currentColor`，绝不往 path 里塞 hex；状态、图形和 aria-label 仍是三条独立识别通道。`focus-visible` 继续使用 focus-ring，disabled 最后生效，hover/active 不得覆盖状态色。

### 3.3 势力详情标题跟随主题

仅在 minimalUi 下，把 `.pm-today-trend-faction-detail-row dt` 改为 `--pm-color-accent`。这覆盖“关系评价”“外部关联”与所有数据化标题（包括诉求），而不需要针对字符串分支。

`<dd>`、摘要和长说明保留 secondary 文本色，且详情值使用 `--pm-line-height-loose`。主题色只负责短标签；把长文本染强调色既不稳也不易读，不能干。

### 3.4 子社区跟随当前社区色

“当前社区色”唯一指活动 `.pm-scene-shell` 上的 `--scene-accent`，而非手机全局主题 `--pm-color-accent`。

实施时审计 `styles/community.css`：

1. 仅将真实子社区内容区中错误消费全局 accent 的“强调色”替换为 `--scene-accent`，包括社区内主要操作、局部选中态、作者/标签与场景内图标。
2. 基础文字、表面、边框、danger、focus-ring 继续使用公共语义 token；`--scene-accent` 不得替代它们。
3. `.pm-desktop-app-icon`、`.pm-quick-reply-actions`、`.pm-desktop-community-dock` 等桌面或通用入口没有当前场景色上下文，继续使用全局 accent，禁止全局搜索替换。
4. 保留 `src/interactive-scene-views.js` / `src/interactive-scene-phone.js` 当前的 accent owner；除非 DOM 证据表明当前 scene accent 未进入根壳，否则不新增状态、不改存储、不扩白名单。

## 4. 影响范围与实施顺序

### A. 侦察与基线

1. 精确搜索 relation symbol 的全部 JS/CSS/测试消费点，以及 `.pm-scene-shell` 内 `--pm-color-accent` 的实际作用域。
2. 获取 minimalUi 开关、五档关系、两种 scene accent、亮暗主题和 320px 的改前视觉证据。
3. 检查 css governance 中 today-trend 私有 token 和 `--scene-accent` owner；只为实际新增 token/owner 修改登记。

### B. 今日风向

预计修改：

- `src/today-trend-ui.js`：增加纯展示 relation symbol helper。
- `src/today-trend-reputation-view.js`、`src/today-trend-faction-view.js`：改为使用 helper；不触及业务状态、数据模型、持久化或 action 分发。
- `styles/today-trend.css`：minimalUi 下收紧 8px 标题—说明节奏、扩展说明行高、移除关系节点负 margin/background-clip 补丁、设置五档实心圆与 SVG 前景、设定 faction `<dt>` 主题色。
- `scripts/css-governance-registry.json`：登记共享 today-trend 私有尺寸 token；不改 `--scene-accent` runtime owner，除非后续证据证明必须改。

### C. 子社区

预计优先只改 `styles/community.css`：将确认属于活动子社区内容且误用全局 accent 的强调属性改为 `--scene-accent`。只有现有 DOM 根没有收到当前 scene accent 时，才最小修改 `interactive-scene-views.js` 或 `interactive-scene-phone.js`，并同步运行时写入治理契约。

### D. 契约、构建与验收

- `scripts/check-today-trend.mjs`：断言 8px/1.75 节奏、44px hit target 与 24px 共同视觉尺寸、五档圆底/SVG 前景、action/ARIA/状态循环未退化，以及普通模式不消费 minimal 色。
- `scripts/check-interactive.mjs`：以两种 scene accent 验证子社区根色、切换更新与全局主题不污染。
- `scripts/check-contracts.mjs`：锁定 minimalUi 作用域、共享 token、禁止 relation 节点再出现负 margin/background-clip/裸色，并锁定社区局部色边界。
- `index.js` 仅由 `npm run build` 更新。

## 5. 验收与风险

### 自动化门禁

依次运行：

1. `npm run build`
2. `npm run check:syntax`
3. `npm run check:today-trend`
4. `npm run check:interactive`
5. `npm run check:contracts`
6. `npm run check`
7. `git diff --check`

既有 `check:behavior`、`check:permissions`、`check:contracts` 失败仍需与隔离 HEAD 对照；本轮任何新失败不得冒充基线债务。

### 人工回归

- minimalUi 的 world/reputation/faction/dynamics：短/长标题、单/多行说明、嵌套势力和事件归档。
- 五档连续循环、SVG 对比度、44px 键盘与触控命中区、24px 可见圆与世界 signal marker 对齐、disabled 与 focus-visible。
- 亮色、暗色、自定义主题、320px。
- 两个不同场景色的子社区切换，确认当前社区内容随 `--scene-accent` 变色，返回桌面或快速回复后仍使用全局主题色。
- 普通模式今日风向、日历、社区数据编辑/保存和上下文注入不回归。

### 风险控制

| 风险 | 控制 |
| --- | --- |
| 将颜色重新设计误做成颜色回退 | 五档状态色必须以圆底 + SVG 前景的配对契约固定；禁止统一中性圆底 |
| 24px 可见圆损害点击性 | 44px 命中区作为透明外层保留，测试和键盘回归验证 |
| 高饱和圆底下 SVG 对比不足 | 使用已有 `on-danger/on-warning/on-accent/on-success`，不写裸白或裸黑 |
| 场景色泄漏到手机主题 | 只在 `.pm-scene-shell` 子树消费 `--scene-accent`，interactive 契约验证全局变量不被写入 |
| 普通模式被波及 | 所有今日风向改动以 `.is-minimal-ui` 为祖先，并保留反向断言 |

本轮不涉及数据迁移。回滚可按“今日风向视觉与契约”或“子社区 CSS 与契约”独立完成，均不触及状态数据、场景存储和主题存储。