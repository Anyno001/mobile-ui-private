# 势力图谱卡片化视觉试点（参考 TASKOW）

## 0. 设计来源与边界

- 来源：助手直接对话需求。用户反馈今日风向布局“太难看”，要求参考 `TASKOW任务管理应用程序UI设计Figma素材` 中朋友导出的真实 PNG 截图重做布局，明确表示先不改任何颜色 token（包括粉色主题测试）。
- 试点范围：仅 **势力图谱**（`.pm-today-trend-factions` / `.pm-today-trend-faction-card`）一个模块，作为样板验证方向；世界态势、个人风评、事件追踪三个模块本轮**不动**，待样板通过人工审查后再决定是否复用同一配方。
- 参考素材：`TASKOW.../Taskow - Design File/Task/In Progress.png`（任务列表卡片）。用户已明确同意“不局限文件名字面意思，哪个视觉语言好用就用哪个”；已排除 `Home.png` 的大卡轮播与 `New Task.png` 的表单卡片，因为势力图谱是树状条目列表，语言上更接近 In Progress 的卡片列表。
- 硬边界（用户与既有规则共同约束）：
  1. 不改 `--pm-color-accent`、`--pm-palette-accent-*`、`THEME_PRESETS.pink` 或任何联系人主题预设；
  2. 不改势力图谱的数据模型、action 分发、ARIA、disabled、五档关系状态机；
  3. 不引入新的全局颜色/阴影/圆角 token，只使用 `docs/CSS-TOKENS.md` 已登记的现成 token；
  4. 不影响极简模式下关系节点“只剩点击区+24px 状态圆”的既有修复（`.pm-today-trend-content.is-minimal-ui .pm-today-trend-faction-entry-head .pm-today-trend-relation-slot>.pm-today-trend-faction-node`），该规则本轮不触碰。

## 1. 已验证现状（根因）

`styles/today-trend.css:205` 起，势力图谱卡片容器的实际声明：

```css
.pm-today-trend-faction-card{display:flex;min-width:0;flex-direction:column;gap:var(--pm-space-2);padding:var(--pm-space-0);border:0;border-radius:var(--pm-radius-card);background:transparent;box-shadow:none;}
```

背景 `transparent`、边框 `0`、内边距 `0`。外层页面背景（`#pm-iphone` → `--pm-bg` → `--pm-color-surface-page`，见 `styles/core.css:5-7`）与卡片背景相同（都是透明，最终显示页面色），卡片之间只靠 `gap:8px` 和子层级的 `margin-left` 缩进区分，没有任何色块或描边分组。这就是“糊成一片”的直接原因：**卡片容器名为卡片，实为无背景的分组容器**。

对照 `docs/CSS-TOKENS.md` 第 8 节标准组件配方：

> 卡片 | `--pm-color-surface-card`；普通分组使用 `--pm-color-border-subtle`，可交互或需强调边界时使用 `--pm-color-border-default`，只保留一道描边；`--pm-radius-card`、space-3 或 space-4 内边距、无阴影

现状完全没有落这条配方——**不是 token 缺失，是现有实现没有使用页面色/卡片色的双层对比**。

`--pm-color-surface-page` 与 `--pm-color-surface-card` 的实际 hex（`docs/CSS-TOKENS.md` 第 4 节）：

| Token | 浅色 | 深色 |
| --- | --- | --- |
| `--pm-color-surface-page` | `#ffffff` | `#1c1c1e` |
| `--pm-color-surface-card` | `#f8f8fa` | `#242429` |

浅色下两者色差极小，仅靠背景色块可能不够清晰，需要按配方叠加 `--pm-color-border-subtle` 一道描边作为第二重视觉线索，不能只加背景色了事。

## 2. TASKOW 参考语言（从 In Progress.png 提取）

已读取的视觉事实（非臆测，直接来自截图）：

- 每条任务是一张**实色圆角卡片**，卡片背景与页面背景有明显色差（页面浅灰、卡片近白）；
- 卡片内部结构自上而下：状态 pill（左上）+ 更多操作图标（右上）→ 标题（加粗，两行内）→ 进度条 → 底部元信息行；
- 卡片间距均匀，不靠描边分隔，纯靠背景色块 + 留白分组；
- 没有阴影，是纯色块层级，与我们 token 规范“普通卡片无阴影”天然吻合。

**不采用的元素**（与势力图谱数据模型不匹配，强行搬会破坏契约或制造假信息）：头像堆叠、进度条、评论数/子任务数徽标——势力图谱没有对应字段。

**采用的元素**：卡片背景色块化、圆角、内边距。

## 3. 目标设计（仅势力图谱）

### 3.1 卡片容器 `.pm-today-trend-faction-card`

| 属性 | 现状 | 目标 |
| --- | --- | --- |
| `background` | `transparent` | `var(--pm-color-surface-card)` |
| `border` | `0` | `1px solid var(--pm-color-border-subtle)` |
| `padding` | `var(--pm-space-0)` | `var(--pm-space-3)`（12px） |
| `border-radius` | `var(--pm-radius-card)` | 不变 |
| `box-shadow` | `none` | 不变 |
| `gap` | `var(--pm-space-2)` | 不变 |

### 3.2 子层级缩进 `.pm-today-trend-faction-tree[data-depth]`

加背景后，缩进区域露出页面底色而非卡片底色，天然形成“父卡片包裹子卡片”层级，符合树状语义，**保留现有缩进声明不变**。

### 3.3 标题行、详情行

结构和颜色语义不变，只是父容器多了 `padding:12px`，与既有 `gap` 组合是合理的“卡片内边距 + 元素间距”，不需要额外调整。

### 3.4 其余三模块

本轮不改，`background:transparent` 原样保留。


## 4. 受影响的现有契约断言（必须同步修改，不是新增）

以下断言当前锁定“背景必须是 transparent / border 必须是 0”，是本次改动**唯一**会触碰的测试面。逐条列出，实施时逐条对照修改：

### `scripts/check-today-trend.mjs`

| 行号 | 现有断言内容 | 处理方式 |
| --- | --- | --- |
| 228 | padding 断言表：`['pm-today-trend-faction-card', 'var(--pm-space-0)']` | 改为 `var(--pm-space-3)` |
| 935 | `/pm-today-trend-faction-card\{[^}]*padding:var(--pm-space-0)[^}]*border:0[^}]*border-radius:var(--pm-radius-card)[^}]*background:transparent[^}]*box-shadow:none/` | 改为断言 `padding:var(--pm-space-3)`、`border:1px solid var(--pm-color-border-subtle)`、`background:var(--pm-color-surface-card)`，`box-shadow:none` 保留 |

### `scripts/check-contracts.mjs`

未发现直接锁定 `.pm-today-trend-faction-card` 背景/边框的独立断言（该文件里匹配到的 `faction-card` / `world-hero` 等命中主要是 grid-column 与 minimal-ui 行高规则，均与本次改动的属性不重叠）。若实施时发现遗漏的隐藏断言，必须先读取上下文确认后再改，不能跳过验证直接假设“没有”。

### 不受影响、必须保持通过的断言（回归红线）

- `check-today-trend.mjs:930-931`：子层级缩进 `margin-left`/`padding-left` 断言——本次不改；
- `check-today-trend.mjs:936`：`pm-today-trend-faction-detail` 不得恢复 border-left/菱形连接器——本次不改，需确认新增的卡片 border 不会被误判命中这条负例（该断言只匹配 `.pm-today-trend-faction-detail` 与 `.pm-today-trend-faction-detail-row::before`，选择器不同，不冲突）；
- `check-contracts.mjs:3782-3784`：`is-minimal-ui .pm-today-trend-faction-card{row-gap:...}` ——本次不改 minimal 模式下的规则，只改普通模式的 `.pm-today-trend-faction-card` 基础声明，需确认 minimal-ui 覆盖规则不会被基础声明的新 border/background 影响（minimal-ui 场景下势力卡片外层节点已有独立覆盖，与卡片容器背景无耦合，风险低但仍需实测）。


## 5. 实施步骤

1. 修改 `styles/today-trend.css:205` 的 `.pm-today-trend-faction-card` 声明：`background:transparent` → `var(--pm-color-surface-card)`；新增 `border:1px solid var(--pm-color-border-subtle)`；`padding:var(--pm-space-0)` → `var(--pm-space-3)`。
2. 同步修改 `scripts/check-today-trend.mjs:228` 的 padding 期望值。
3. 同步修改 `scripts/check-today-trend.mjs:935` 的正则断言，拆分为对 background/border/padding 的独立正例断言（避免一条超长正则难以维护，也方便后续单独排查某一属性回归）。
4. 搜索确认 `check-contracts.mjs` 中是否存在遗漏的隐藏断言（`search_in_files` 精确匹配 `pm-today-trend-faction-card` 全量结果）。
5. 运行 `npm run build`、`npm run check:syntax`、`npm run check:today-trend`、`npm run check:contracts`、`npm run check`、`git diff --check`，逐条记录 exit code。
6. 人工核对：亮色/暗色主题下卡片背景与页面背景是否有可分辨色差；子层级嵌套是否形成清晰的父子卡片视觉；320px 窄屏下 padding 是否挤压内容；极简模式下势力节点大圆修复是否仍然生效（回归红线）。

## 6. 验收标准

- [ ] 势力图谱普通模式下，每条势力/子势力呈现为独立可辨的卡片（背景色 + 描边），不再与页面背景糊在一起。
- [ ] 树状缩进的父子层级在视觉上清晰（子卡片背景与父卡片背景因缩进露出页面色而形成层次）。
- [ ] 亮色、暗色、320px 窄屏、极简模式四种场景均验证通过。
- [ ] 未改动关系状态机、ARIA、disabled、action 分发、五档颜色语义。
- [ ] 未改动 `--pm-color-accent`、`--pm-palette-accent-*`、`THEME_PRESETS.pink`。
- [ ] 世界态势、个人风评、事件追踪三个模块的 CSS 声明零改动（git diff 只包含势力图谱相关行）。
- [ ] 构建、语法检查、今日风向契约、静态契约、全量 check、`git diff --check` 全部 exit 0。
- [ ] 助手人工审查势力图谱样板效果后确认是否将同一配方复用到其余三个模块。

## 7. 明确排除项（本轮不做）

- 不做粉色主题测试或任何 accent token 改动；
- 不改世界态势 hero/brief、个人风评 entry、事件追踪 card 的背景（留待样板确认后再规划）；
- 不引入头像堆叠、进度条、评论数等 TASKOW 独有但势力图谱无对应数据的 UI 元素；
- 不新增任何全局或组件私有 token，只复用 `docs/CSS-TOKENS.md` 已登记的 `--pm-color-surface-card`、`--pm-color-border-subtle`、`--pm-space-3`。
