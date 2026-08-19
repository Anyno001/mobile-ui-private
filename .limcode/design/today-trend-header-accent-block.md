# 今日风向顶栏主题色实底与标题重排

## 0. 范围与确认结论

用户已明确的四项确认（对话原文）：

1. 顶栏 `.pm-today-trend-header` 去描边、改主题色实底。
2. 参考 TASKOW/钱包类 App：主题色仅覆盖顶栏区域，不铺满整页；内容区（含四个模块的卡片）以圆角浮层衔接在主题色块之下。采用**简化版**：顶栏本身即色块，内容区顶部圆角直接衔接，不新增额外固定/动态高度过渡区块。
3. 卡片内部颜色要比外部（页面）浅，且禁止描边——这与既有 `--pm-color-surface-card` 浅于 `--pm-color-surface-page` 的语义一致，但当页面背景变成主题色块后，需要重新确认卡片背景色阶是否仍然“浅于外部”。
4. 标题重排：元数据（如 `GROUPS 12 · CORE 3 · LINKS 5`）在上，中文标题在下，整体居中；操作菜单（省略号）移至右上角悬浮。
5. 关系图标配色（原第 3 条）本轮**不做**，用户已明确搁置，避免在背景语境未定时做无意义调色。

## 1. 已验证现状

### 1.1 顶栏 DOM 与样式

`src/today-trend-view.js:71`：

```html
<header class="pm-today-trend-header">
  <button class="pm-today-trend-home">...</button>
  <h2 id="pm-today-trend-title">今日风向</h2>
  <span class="pm-today-trend-header-actions">...两个 header-control 按钮...</span>
</header>
```

`styles/today-trend.css:2`：

```css
.pm-today-trend-header{position:sticky;top:0;z-index:var(--pm-z-base);display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:var(--pm-space-1);padding:var(--pm-space-1-5) var(--pm-space-px-9);border-bottom:1px solid var(--pm-color-border-subtle);background:var(--pm-color-surface-page);}
```

三个子元素当前前景色：

- `.pm-today-trend-home`（返回桌面）：`color:var(--pm-color-text-placeholder)!important`（`styles/today-trend.css:7`）
- `.pm-today-trend-header h2`（标题文字）：继承 `.pm-today-trend-shell{color:var(--pm-color-text-primary)}`
- `.pm-today-trend-header-actions .pm-today-trend-header-control`：`aria-pressed=false` 时 `text-tertiary`，`aria-pressed=true` 时 SVG 用 `--pm-color-auxiliary`（`styles/today-trend.css:10-11`）
- 所有 header 按钮默认 `color:var(--pm-color-text-tertiary)`（`styles/today-trend.css:3`）

**这些前景色全部是浅色主题下的深灰/黑系文字色，一旦背景换成 `--pm-color-accent` 实底，会出现深色文字压深色背景，对比度归零。这是本次改动必须同步处理的部分，不是可选项。**

### 1.2 内容区与顶栏的兄弟关系

`.pm-today-trend-shell{display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;}`（`styles/today-trend.css:1`），`.pm-today-trend-header` 和 `.pm-today-trend-content`（或 `first-use`/`settings`）是同级网格行，`header` 占 `auto` 行，内容占 `minmax(0,1fr)` 行。两者没有嵌套关系，纯 CSS 即可实现“顶栏色块 + 内容区圆角覆盖”，不需要改 DOM 结构。

### 1.3 module-head 结构（四模块共享 `trendModuleHead` 生成）

`src/today-trend-ui.js:62-66`：

```js
export function trendModuleHead({ title, menuId, menuOpenId, actions = [], meta = '', metaHtml = '', eyebrow = '', adornment = '', asideHtml = '' }) {
    const renderedMeta = metaHtml || (meta ? `<span>${escapeHtml(meta)}</span>` : '');
    const menu = trendActionMenu({ id: menuId, open: menuOpenId === menuId, label: `${title}操作`, actions });
    return `<header class="pm-today-trend-module-head${eyebrow ? ' is-decorative' : ''}"><div>${eyebrow ? `<p class="pm-today-trend-module-eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<h2>${escapeHtml(title)}${adornment}</h2>${renderedMeta}</div><span class="pm-today-trend-head-tools">${menu}${asideHtml}</span></header>`;
}
```

渲染顺序：`<div>`内 `eyebrow`(英文装饰) → `<h2>`(中文标题) → `metaHtml`(GROUPS/CORE/LINKS 等统计)；`<span class="head-tools">` 内 `menu`(省略号菜单) + `asideHtml`(仅世界态势/个人风评/势力图谱/事件追踪各自的 `floorStatus` 同步状态组件)。

四个视图调用点（均传入 `eyebrow` 英文装饰）：

- `src/today-trend-world-view.js:46`：`eyebrow: 'TODAY’S SIGNAL'`，`metaHtml: worldMeta`（`trendMeter([{label:'SIGNALS',...},{label:'BRIEFS',...}])`）
- `src/today-trend-reputation-view.js:45`：`eyebrow: 'PUBLIC OPINION'`，`metaHtml`（`trendMeter([{label:'PEOPLE',...},{label:'GOOD',...},{label:'BAD',...}])`）
- `src/today-trend-faction-view.js:39`：`eyebrow: 'POWER MAP'`，`metaHtml: mapMeta`（`trendMeter([{label:'GROUPS',...},{label:'CORE',...},{label:'LINKS',...}])`，即用户截图里的 `GROUPS 12 · CORE 3 · LINKS 5`）
- `src/today-trend-dynamics-view.js:58`：`eyebrow: 'EVENT TRACKER'`，`metaHtml: trackerMeta`

### 1.4 CSS 中三套并行的 module-head 覆盖规则

- 世界态势专属：`styles/today-trend.css:313-322`
- 个人风评/势力图谱/事件追踪共享：`styles/today-trend.css:166-174`
- 极简模式覆盖：`styles/today-trend.css:227-232`（本次不改极简模式，需要在实施中确认新布局不破坏极简覆盖）

三套规则都遵循同一模式：`eyebrow` 用 `--pm-color-accent` 小字，`h2` 用统一字号 token，`metaHtml` 走 `trendMeter` 组件（`styles/today-trend.css:307-312`：`.pm-today-trend-meter` 使用 `text-tertiary`，`meter-v` 用 `text-secondary`）。

## 2. 目标设计

### 2.1 顶栏主题色实底（对应确认项 1）

`.pm-today-trend-header`：

| 属性 | 现状 | 目标 |
| --- | --- | --- |
| `background` | `var(--pm-color-surface-page)` | `var(--pm-color-accent)` |
| `border-bottom` | `1px solid var(--pm-color-border-subtle)` | 移除 |

前景色跟随调整（对比度必须达到 3:1 图标线 / 4.5:1 文字线）：

| 元素 | 现状 | 目标 |
| --- | --- | --- |
| `.pm-today-trend-home` | `--pm-color-text-placeholder` | `--pm-color-on-accent` |
| `.pm-today-trend-header h2` | 继承 `text-primary` | `--pm-color-on-accent`（在 header 内单独声明，不动 `.pm-today-trend-shell` 的全局文字色） |
| `.pm-today-trend-header button`（默认态） | `--pm-color-text-tertiary` | `--pm-color-on-accent`，配合降低透明度或使用 `color-mix` 弱化默认态与激活态的区分（避免所有图标同色分不清主次） |
| `.pm-today-trend-header button:hover/:focus-visible` | `--pm-color-text-secondary` | 保持 `--pm-color-on-accent`，用背景 `color-mix(in srgb,var(--pm-color-on-accent) 16%,transparent)` 表达 hover，而非变色 |
| `.pm-today-trend-header-actions .pm-today-trend-header-control[aria-pressed="true"] svg` | `--pm-color-auxiliary` | 需要重新判断：`--pm-color-auxiliary` 在 accent 实底上是否仍可辨；若对比不足，改为 `--pm-color-on-accent` 加下划线/圆点等非纯色区分手段 |
| focus-visible outline | `--pm-color-text-secondary` | `--pm-color-on-accent`，确保深色实底上键盘焦点仍可见 |

**风险**：`--pm-color-on-accent` 未在 `docs/CSS-TOKENS.md` 登记表中出现（登记的是 `on-accent:#ffffff`，见文档第 88 行，实际是存在的，之前只是没在本轮之前读到）。经核实 `--pm-color-on-accent:#ffffff` 已登记，可直接使用，不需要新增 token。

**必须验证的对比度**：`--pm-color-accent` 浅色主题为 `#1677d2`，深色主题为 `#0a84ff`；`--pm-color-on-accent` 为 `#ffffff` 双主题一致。白色对 `#1677d2` 和 `#0a84ff` 的对比度均需在实施后用 `scripts/check-contracts.mjs` 现成的对比度计算逻辑验证 ≥ 3:1（图标/大文字）。

### 2.2 内容区圆角浮层衔接（对应确认项 2，简化版）

不新增结构层，只调整 `.pm-today-trend-content`（及 `first-use`/`settings` 等同级视图容器，需要确认是否所有 content 变体都要浮层化，还是只做主 `.pm-today-trend-content`）：

- 顶部圆角：`border-radius:var(--pm-radius-large) var(--pm-radius-large) var(--pm-radius-none) var(--pm-radius-none)`（16px，参考 token 表里已有的 `--pm-radius-large`，不新增圆角值）；
- 背景保持 `var(--pm-color-surface-page)`（页面色，不变）；
- 由于 `.pm-today-trend-shell` 的 `grid-template-rows:auto minmax(0,1fr)` 结构，`content` 天然从 `header` 底部开始铺满剩余空间，圆角自然形成“浮层盖住色块下缘”的视觉，不需要负 margin 或 transform 技巧。

**需要确认的点**：顶栏与内容区之间没有留白（`grid-template-rows:auto ...` 紧贴），圆角衔接会是“直接咬合”而不是“浮起有间隙”的钱包截图效果。如果你要的是内容区整体略微上移、露出更多色块（类似截图里卡片和色块之间有明显间隙），需要在 content 顶部加 `margin-top:calc(0px - Npx)` 类负偏移或改用 `padding-top` 值——**这个我尚未从你的描述里得到明确要求，默认先做直接咬合的简化版，若你看效果后觉得需要间隙再迭代**。

### 2.3 四模块卡片背景收紧（对应确认项 3）

当前四模块卡片已经是 `background:var(--pm-color-surface-card)`（本轮之前的改动），页面背景是 `var(--pm-color-surface-page)`。这组对比在“页面色=主题色实底”之后不再适用——**卡片背景需要比新的外部背景（顶栏是主题色，但卡片所在的内容区背景仍是页面色 `--pm-color-surface-page`）浅**，也即卡片和内容区背景的关系不变（沿用现有 `surface-card` vs `surface-page` 搭配），因为卡片不会直接贴着主题色块，它们中间隔着内容区的页面色背景。

**结论：卡片背景色阶本次不需要改动**，`--pm-color-surface-card` 相对 `--pm-color-surface-page` 已经更亮（浅色主题 `#f8f8fa` vs `#ffffff`，实际卡片比页面稍深而非稍浅——这里需要澄清一个术语理解）。


**用户已确认**：卡片要比周围（内容区页面背景）更白更亮，不是现状的“略深”。浅色主题下，卡片背景需要从 `--pm-color-surface-card`（`#f8f8fa`，比页面色略深）改为直接使用 `--pm-color-surface-page`（`#ffffff`，与页面同色，靠去描边+留白分组）或引入更浅的表达方式。深色主题同理，需要卡片比内容区背景更亮。

**方案**：四模块卡片背景统一改为 `var(--pm-color-surface-page)`。此时卡片和内容区背景色值相同，视觉分组将完全依赖：

1. 留白（`gap`、`padding`）；
2. 圆角（`--pm-radius-card`）在页面色背景上不会产生任何可见轮廓——**这是必须向你指出的技术后果**：如果卡片背景和内容区背景是同一个颜色值，圆角和背景色本身不会产生任何看得见的卡片边界，用户将完全看不出“这是一张卡片”，只会看到留白分隔的纯文本块。

**这与“卡片化”的初始目的（让每条势力/风评/事件从背景中被视觉区分出来）直接冲突。** 我需要在这里明确警示：如果卡片背景色等于外部背景色，且明确禁止描边，卡片将失去所有可见边界，退回到本轮最初解决的“糊成一片”问题。

**建议的替代方案**（不违背“卡片更白更亮”的方向，但保留可辨识边界）：

- 方案 A：卡片背景使用 `var(--pm-color-surface-page)`（更白），内容区改用比页面色更深一档的背景（例如复用 `--pm-color-surface-elevated:#f2f2f7`），让内容区整体背景比卡片深，从而卡片在深色内容区上凸显为更白的浮层。这样卡片确实“更白”，且视觉边界靠内容区背景变深来实现，不需要给卡片加描边。
- 方案 B：保留卡片 `--pm-color-surface-card`（比页面色略深）不变，只是接受“卡片比外部深一点”而非“更白”这一现状，用留白与圆角配合弱阴影替代描边（但 `docs/CSS-TOKENS.md` 明确禁止普通卡片阴影，此路不通）。

**本文档采用方案 A**，需要你确认：内容区背景从 `--pm-color-surface-page` 改为 `--pm-color-surface-elevated`，卡片背景改为 `--pm-color-surface-page`，两者形成“卡片更白、内容区背景更深”的层次，同时保持零描边。若你不认可这个方向，请直接指出应如何在“不留边界线索”的情况下仍能分辨卡片范围。

**必须向你确认的术语澄清**：`docs/CSS-TOKENS.md` 里 `--pm-color-surface-card` 浅色值是 `#f8f8fa`，`--pm-color-surface-page` 浅色值是 `#ffffff`——卡片比页面**略深**，不是“更浅”。你说“卡片内部颜色要比外面浅”，如果指的是浅色主题下卡片应该比背景更亮（比如卡片用白色、背景用浅灰），那和当前 token 定义（卡片比页面深一点点）方向相反，需要重新指定颜色深浅关系，而不是打补丁式调整。**这处若不澄清，后续验收会出现“做完你说的还是不对”的情况**，故列为本文档待确认事项，实施前必须拿到你的答复。

禁止描边这条明确：四模块卡片的 `border:1px solid var(--pm-color-border-subtle)` 要移除，只保留背景色差异做分组，不再叠加描边。

### 2.4 标题重排（对应确认项 4）

`trendModuleHead` 改造：

**DOM 顺序**（新）：

```html
<header class="pm-today-trend-module-head">
  <span class="pm-today-trend-head-tools">...menu + asideHtml...</span>  <!-- 绝对定位悬浮右上角 -->
  <div>
    <span class="pm-today-trend-module-meta-line">GROUPS 12 · CORE 3 · LINKS 5</span>  <!-- 原 metaHtml，现在在上 -->
    <h2>势力图谱</h2>  <!-- 中文标题，现在在下 -->
  </div>
</header>
```

- 移除 `eyebrow`（英文装饰）传参与渲染，四个视图文件的 `eyebrow: 'XXX'` 全部删除；
- `<div>` 内部顺序对调：`metaHtml` 在上、`h2` 在下；
- `<div>` 整体改为 `align-items:center;text-align:center`，`.pm-today-trend-module-head` 从 `justify-content:space-between` 改为 `justify-content:center`（标题居中）；
- `.pm-today-trend-head-tools` 改为 `position:absolute;top:...;right:...`，脱离 flex 布局参与居中计算；
- `asideHtml`（`floorStatus` 同步状态组件）目前也在 `head-tools` 里，需要确认它是否也要悬浮到右上角，还是需要另找位置——**这是实施中要检查的细节，不影响整体方向，但需要在编码时逐一验证不会和 menu 挤在一起**。

**必须同步修改的四处调用**：

- `src/today-trend-world-view.js:46`
- `src/today-trend-reputation-view.js:45`
- `src/today-trend-faction-view.js:39`
- `src/today-trend-dynamics-view.js:58`

**必须同步修改的三套 CSS 规则**（世界态势专属 `313-322`、共享 `166-174`、极简模式 `227-232`），全部要从当前基于 `eyebrow`/`h2`/`metaHtml` 从上到下、左对齐的假设改为 `metaHtml`/`h2` 从上到下、居中对齐。


## 3. 用户最终确认（覆盖上述待确认项）

- 内容区与顶栏色块：**咬合**，不留间隙。2.2 节默认方案生效，不做负偏移间隙处理。
- 卡片层次：**方案 A 确认**。内容区背景 `--pm-color-surface-page` → `--pm-color-surface-elevated`；四模块卡片背景 `--pm-color-surface-card` → `--pm-color-surface-page`；卡片描边 `1px solid var(--pm-color-border-subtle)` 全部移除。

## 4. 精确改动清单（含行号）

### 4.1 `styles/today-trend.css`

| 行号 | 选择器 | 改动 |
| --- | --- | --- |
| 1 | `.pm-today-trend-shell` | 不改 |
| 2 | `.pm-today-trend-header` | `background:var(--pm-color-surface-page)` → `var(--pm-color-accent)`；移除 `border-bottom:1px solid var(--pm-color-border-subtle)` |
| 3 | `.pm-today-trend-header button,.pm-today-trend-icon-button` | 注意：此规则同时命中 header 按钮和其他模块的 icon-button，不能整体改色，需拆分出 header 专属规则，仅对 `.pm-today-trend-header button` 单独声明 `color:var(--pm-color-on-accent)` |
| 4 | hover/focus-visible | 同上拆分后处理，hover 态改为 `background:color-mix(in srgb,var(--pm-color-on-accent) 16%,transparent)`，不再变色 |
| 5 | focus-visible outline | 拆分后 header 专属改为 `outline-color:var(--pm-color-on-accent)` |
| 7 | `.pm-today-trend-home` | `color:var(--pm-color-text-placeholder)!important` → `var(--pm-color-on-accent)!important` |
| 8 | `.pm-today-trend-home:hover/:focus-visible` | `color:var(--pm-color-text-secondary)!important` → `var(--pm-color-on-accent)!important`；hover 背景改用 on-accent 的 color-mix |
| 10 | `header-control[aria-pressed=false]` | `color:var(--pm-color-text-tertiary)` → `color-mix(in srgb,var(--pm-color-on-accent) 70%,transparent)`（弱化默认态，与激活态区分） |
| 11 | `header-control[aria-pressed=true] svg` | `color:var(--pm-color-auxiliary)` → 需要在实施后用对比度工具验证 `--pm-color-auxiliary` 在 accent 实底上是否可辨；若不可辨，改为 `var(--pm-color-on-accent)` 并额外加下划线/圆点指示激活态（具体样式在实施时按实际对比度决定，不预先假设） |
| 12 | `.pm-today-trend-header h2` | 新增 `color:var(--pm-color-on-accent)` |
| 13 | `.pm-today-trend-content` | 新增 `background:var(--pm-color-surface-elevated)`；新增 `border-radius:var(--pm-radius-large) var(--pm-radius-large) var(--pm-radius-none) var(--pm-radius-none)` |
| 146 | `.pm-today-trend-world-hero,.pm-today-trend-world-brief` | `border:1px solid var(--pm-color-border-subtle)` → 移除（改 `border:0`）；`background:var(--pm-color-surface-card)` → `var(--pm-color-surface-page)` |
| 177 | `.pm-today-trend-reputation-entry` | 同上 |
| 205 | `.pm-today-trend-faction-card` | 同上 |
| 264 | `.pm-today-trend-event-card` | 同上 |
| 166-174 | 共享 module-head（reputation/factions/dynamics） | 改为 metaHtml 在上、h2 在下、居中；head-tools 绝对定位右上角 |
| 313-322 | 世界态势专属 module-head | 同上 |
| 227-232 | 极简模式覆盖 | 检查是否需要同步调整，若极简模式下 metaHtml 本身不显示（需要先确认极简模式是否渲染 meter），则可能不受影响 |

### 4.2 `src/today-trend-ui.js`

`trendModuleHead`（第 62-66 行）：

- 参数移除 `eyebrow`；
- 渲染顺序改为：`<div>` 内先渲染 `renderedMeta`（原 metaHtml/meta），再渲染 `<h2>`；
- `<span class="pm-today-trend-head-tools">` 移到 `<header>` 内但通过 CSS `position:absolute` 定位，不依赖 DOM 顺序影响布局流。

### 4.3 四个视图文件

- `src/today-trend-world-view.js:46`：删除 `eyebrow: 'TODAY’S SIGNAL',`
- `src/today-trend-reputation-view.js:45`：删除 `eyebrow: 'PUBLIC OPINION',`
- `src/today-trend-faction-view.js:39`：删除 `eyebrow: 'POWER MAP',`
- `src/today-trend-dynamics-view.js:58`：删除 `eyebrow: 'EVENT TRACKER',`

## 5. 受影响的现有契约断言（实施中逐条核查，不得只凭关键词搜索假设无遗漏）

已知会命中的检查点（`scripts/check-today-trend.mjs`）：

- 势力图谱/世界态势/个人风评/事件追踪卡片的 `padding:var(--pm-space-3)[^}]*border:1px solid var(--pm-color-border-subtle)[^}]*background:var(--pm-color-surface-card)` 四条断言（上一轮新增，现在行号约在 225-228 附近，需要重新搜索确认）——全部要改为 `border:0` + `background:var(--pm-color-surface-page)`。
- `.pm-today-trend-header` 相关的既有断言（返回桌面色、tabs 激活色等，来自更早一轮的导航修复），需要重新搜索确认是否有断言依赖 `--pm-color-text-placeholder`/`border-bottom` 等即将变更的属性。
- `check-contracts.mjs` 中对 `.pm-today-trend-world-hero`/`.pm-today-trend-reputation-entry-body` 等 grid-column 相关断言不受背景/描边改动影响，但涉及 `eyebrow`/`module-eyebrow` 的断言需要核查并同步删除或改写。

本设计文档不预先罗列全部行号，因为上一轮已证明关键词搜索会有遗漏（`check-contracts.mjs:3745` 曾漏检），实施时必须在改完 CSS/JS 后立即跑 `check:today-trend`/`check:contracts`，用脚本报错定位剩余遗漏，而不是自信声称“搜索过了没有遗漏”。

## 6. 实施步骤

1. 精确搜索并核实所有 `eyebrow`、`module-eyebrow`、`background:var(--pm-color-surface-card)`（今日风向范围内）、`.pm-today-trend-header` 相关的现有断言。
2. 修改 `styles/today-trend.css`：顶栏主题色实底、内容区背景与圆角、四模块卡片背景与描边、三套 module-head 布局规则。
3. 修改 `src/today-trend-ui.js` 的 `trendModuleHead`。
4. 修改四个视图文件，移除 `eyebrow` 传参。
5. 运行 `check:today-trend`、`check:contracts`，根据报错逐条修正断言，不得静默跳过任何失败。
6. 运行 `build`、`check:syntax`、全量 `check`、`git diff --check`。
7. 人工核对：亮暗主题下顶栏文字/图标对比度、卡片与内容区背景层次是否清晰可辨、极简模式是否回归、320px 窄屏、标题居中后长标题是否溢出、键盘焦点顺序是否受 head-tools 绝对定位影响。

## 7. 验收标准

- [ ] 顶栏为主题色实底，无下描边，桌面/暗色/自定义主题下文字与图标对比度达标（图标 3:1，文字 4.5:1，若达不到则调整前景色而非跳过验证）。
- [ ] 内容区背景比卡片背景深一档，卡片零描边仍可清晰辨认边界。
- [ ] 四模块标题：元数据在上、中文标题在下、整体居中；菜单按钮在右上角悬浮，不与标题重叠、不遮挡长标题。
- [ ] 极简模式、320px 窄屏、键盘焦点、disabled、ARIA 均无回归。
- [ ] 关系图标颜色未被改动（本轮明确排除）。
- [ ] 构建、语法检查、今日风向契约、静态契约、全量 check、`git diff --check` 全部 exit 0。
