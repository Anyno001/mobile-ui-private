## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 统一日历五类“XX设置”原生 summary 的 44px 配方、展开箭头及与首个下方模块的 --pm-space-2 留白  `##calendar-management-summary`
- [x] 更新今日风向、日历专项与公共 CSS 契约，锁定作用域、排版、楼层五态、状态色、日历箭头和原生展开语义  `##minimal-contract-tests`
- [x] 仅在 .is-minimal-ui 中取消今日风向标题工具区负上移并统一楼层五态的右对齐、行高、gap 与多位数显示  `##minimal-floor-layout`
- [x] 仅在 .is-minimal-ui 中统一今日风向四类条目标题到首段说明/信息块为 --pm-space-3  `##minimal-four-module-content-spacing`
- [x] 仅在 .is-minimal-ui 中统一今日风向四模块大标题的字号结果、行高、父级 gap、统计区 margin 和底部节奏  `##minimal-module-header`
- [x] 仅在 .is-minimal-ui 中用现有主题语义 token 实现五档关系状态颜色及亮暗主题对比  `##minimal-status-colors`
- [x] 仅在个人风评与势力图谱的简易关系按钮上输出当前 data-status，保留动作、ARIA、禁用和焦点契约  `##minimal-status-hooks`
- [x] 重新构建并运行语法、契约、今日风向、日历、完整检查、git diff 检查及亮暗/窄屏人工回归  `##minimal-validation`
<!-- LIMCODE_TODO_LIST_END -->

# 今日风向简易模式与日历设置入口 UI 优化

## 1. 计划来源与范围确认

本计划来源于助手的直接需求及连续澄清，包含两组 UI 修改：

### 1.1 今日风向

仅在“简易模式”开启时生效。代码字段为 `scope.injection.minimalUi`，内容页隔离钩子为 `.pm-today-trend-content.is-minimal-ui`。

目标包括：

- 统一世界态势、个人风评、势力图谱、事件追踪/事件归档的大标题排版，修正四字中文标题视觉上浮。
- 整理大标题右侧楼层值与同步状态的对齐和行间节奏。
- 统一四个生成内容区域中“条目标题 → 首段说明/首个信息块”的间距。
- 为个人风评与势力图谱的可点击关系图标增加主题语义状态色。

“大标题”不包括手机最上方固定栏的“今日风向”。

### 1.2 日历

日历没有 `minimalUi` 隔离，修改作用于同一日历管理组件的五种模式：

- 日历设置
- 天气设置
- 生理期设置
- 菜谱设置
- 穿搭设置

目标包括：

- 拉开“XX设置”折叠标题与展开后首个下方模块的距离。
- 为“XX设置”增加明确的可展开/收起箭头。
- 保留原生 `<details>/<summary>` 语义、键盘操作和展开状态保存。

## 2. 已验证现状

### 2.1 今日风向模块头与楼层

`src/today-trend-ui.js` 的 `trendModuleHead()` 统一输出眉题、大标题、统计信息、操作菜单和楼层状态；`trendFloorStatus()` 输出 synced、unsynced、updating、failed、canceled、unavailable 等状态。

`styles/today-trend.css` 当前存在以下问题：

- 四模块标题工具区均被 `translateY(-var(--pm-space-2))` 人为上移。
- 左侧标题栈已有父级 `gap`，统计仪表又单独设置 `margin-top`，造成双重间距和视觉重心失衡。
- 大标题、楼层值和楼层状态使用不同的行高体系；楼层内部 `gap:0`，`#N` 与状态文字过紧。
- 更新中状态使用按钮容器，空闲状态使用普通元素；若不统一内部布局，状态切换时会出现高度跳动。
- 普通模式已有明确契约，因此本次必须使用 `.is-minimal-ui` 高特异性覆盖，不能修改基础规则。

### 2.2 今日风向四类生成内容

- 世界态势 hero 标题到说明为 `--pm-space-3`，brief 最终生效值为 `--pm-space-1-5`，同一模块内部不统一。
- 个人风评标题栏到评价正文由条目 `gap:--pm-space-2` 控制。
- 势力图谱标题栏到简介由卡片 `gap:--pm-space-2` 控制；简介到关键资料是次级内容关系。
- 事件追踪主层级由 `.pm-today-trend-event-body` 的 `gap:--pm-space-2` 控制，事实区另有负起始偏移，把说明内容重新向上拉紧。
- 四类列表间距大多已是 `--pm-space-3`，问题主要在条目内部，不应重复扩大列表级 gap。

### 2.3 今日风向关系按钮

- `src/today-trend-reputation-view.js` 已在简易模式输出 `today-trend-cycle-circle-status` 按钮。
- `src/today-trend-faction-view.js` 已在简易模式输出 `today-trend-cycle-faction-status` 按钮。
- `src/today-trend-actions.js` 已实现五档循环、提交、禁用、错误处理和重绘后焦点恢复。
- 当前按钮没有供 CSS 消费的状态属性，五档视觉均为同一强调色。

### 2.4 日历“XX设置”入口

`src/calendar-view.js` 的 `renderCalendarManagement()` 在五种模式中重复输出：

```html
<details class="pm-calendar-management" data-calendar-management="..."><summary>XX设置</summary><div class="pm-calendar-management-content">...</div></details>
```

已确认：

- 原生 `<details>/<summary>` 已提供点击与键盘展开能力。
- `src/calendar-page-view.js` 与 `src/calendar.js` 会保存并恢复当前模式的 `open` 状态。
- `styles/calendar.css` 隐藏了浏览器默认 marker，但没有提供替代图标，因此用户失去“可以点开”的视觉提示。
- `.pm-calendar-management-content` 只有纵向 flex，没有顶部 padding 或结构性 gap；summary 与首个设置卡之间缺少清晰分隔。
- 天气设置还存在单独的更小 summary 字号和 padding 覆盖，导致同类入口配方不一致。
- `src/icons.js` 已有 `CHEVRON_DOWN_ICON_SVG`，日历月份标题也已复用该图标及展开旋转逻辑，不需要新增 SVG 资产。

## 3. 目标与非目标

### 3.1 目标

1. 今日风向简易模式四模块大标题保留大标题层级，同时统一字号结果、字重、行高和垂直节奏。
2. 今日风向简易模式楼层值与状态文字右对齐稳定，五态切换不明显跳动，多位楼层不截断。
3. 今日风向四类条目标题到首段说明/信息块统一为 `--pm-space-3`。
4. 简易关系按钮按 hostile、dislike、neutral、like、trust 显示克制的主题语义色。
5. 日历五类“XX设置”入口使用同一可点击配方和至少 44px 命中高度。
6. 日历 summary 右侧显示向下箭头，展开时旋转，关闭时恢复。
7. 日历 summary 与展开内容之间使用已登记间距 token 建立明确留白。

### 3.2 非目标

- 不修改顶部固定栏“今日风向”。
- 不修改今日风向普通模式视觉。
- 不修改今日风向或日历的数据模型、存储版本、生成、注入或调度逻辑。
- 不重写 `trendModuleHead()`、`trendFloorStatus()` 或日历 `<details>` 展开逻辑。
- 不改变关系状态循环顺序。
- 不顺手清理世界态势普通模式的重复 brief 间距规则。
- 不把日历 summary 改成自制按钮，也不手工维护 `aria-expanded`；原生 `<details>` 已提供正确语义。
- 不使用 `!important`、绝对定位、负 margin、裸颜色或新全局 token 解决本次视觉问题。

## 4. 影响范围

### 4.1 预计修改

- `styles/today-trend.css`
  - 新增严格限定于 `.pm-today-trend-content.is-minimal-ui` 的模块头、楼层、四类内容节奏和状态色规则。
- `src/today-trend-reputation-view.js`
  - 仅在简易关系按钮上输出当前 `data-status`。
- `src/today-trend-faction-view.js`
  - 仅在简易关系按钮上输出当前 `data-status`。
- `src/calendar-view.js`
  - 复用 `CHEVRON_DOWN_ICON_SVG`，统一五类 management summary 的结构。
- `styles/calendar.css`
  - 统一 summary 配方、箭头状态、展开内容顶部留白和 reduced-motion。
- `scripts/check-today-trend.mjs`
  - 增加今日风向简易模式专项断言。
- `scripts/check-calendar.mjs`
  - 增加五类 summary 结构、箭头、间距和原生展开语义断言。
- `scripts/check-contracts.mjs`
  - 锁定两组件的 token、作用域、触控尺寸和禁止模式。
- `index.js`
  - 通过 `npm run build` 重新生成，不手工编辑。

### 4.2 不预计修改

- `src/today-trend-ui.js`
- `src/today-trend-world-view.js`
- `src/today-trend-dynamics-view.js`
- `src/calendar-page-view.js`
- `src/calendar.js`
- `styles/core.css`
- 任何模型、存储和迁移文件

## 5. 实施步骤

### 阶段 A：今日风向简易模式大标题标准

1. 在 `.pm-today-trend-content.is-minimal-ui` 下同时覆盖四模块 `.pm-today-trend-module-head`，统一 `align-items`、最小高度和 `padding-bottom:var(--pm-space-3)`。
2. 保留现有大标题字号层级和 semibold 字重；四个模块的最终字号结果必须一致。
3. 使用已登记行高 token 统一中文四字标题行盒，不添加裸行高或位置偏移。
4. 统一 `.pm-today-trend-module-head>div` 的父级 gap。
5. 将简易模式 `.pm-today-trend-meter` 的额外 `margin-top` 重置为 `--pm-space-0`，避免父 gap 与子 margin 叠加。
6. 保留眉题和统计信息，不通过隐藏内容制造整齐。

**验收：** 四模块大标题字号、字重、行高和上下节奏一致，标题不再因双重间距显得上浮。

### 阶段 B：今日风向简易模式楼层状态

1. 仅在 `.is-minimal-ui` 下覆盖 `.pm-today-trend-head-tools`，取消 `translateY(-var(--pm-space-2))` 人工上移。
2. 保持工具区纵向结构、右边缘对齐及“菜单在上、楼层在下”的 DOM 顺序。
3. 统一 `.pm-today-trend-floor` 与 `.pm-today-trend-floor-cancel` 的 gap、对齐和行盒。
4. 统一 reading、value、status 的行高体系，保留 tabular nums、nowrap 和 max-content。
5. failed、canceled、updating 等状态颜色继续使用现有语义 token。
6. 320px 下可收敛状态文字宽度，但 `#3000` 等关键楼层值必须完整显示。

**验收：** 五态的右边缘和行间留白稳定，切换时无明显上下跳动，多位楼层不截断。

### 阶段 C：今日风向四类内容标题—说明节奏

所有规则仅在 `.is-minimal-ui` 下生效，统一目标为 `var(--pm-space-3)`：

1. 世界态势 hero 与 brief 的说明 `margin-top` 统一。
2. 个人风评条目使用 `row-gap` 控制标题栏到评价正文。
3. 势力图谱卡片使用 `row-gap` 控制标题栏到简介；简介后的关键资料保持次级节奏。
4. 事件追踪 body 使用 `row-gap` 统一标题、标签、事实和阶段主层级，并仅在简易模式将 facts 的负起始偏移归零。
5. 保留 active/archived 阶段记录内部差异。
6. 不再次扩大列表级 gap、卡片 padding、字号或触控区。

**验收：** 四个区域标题向下到首段说明/首个信息块均具有一致的 12px 呼吸感；普通模式不变。

### 阶段 D：今日风向简易关系状态钩子与颜色

1. 仅在个人风评和势力图谱的简易按钮上输出 `data-status`。
2. 保持 data-action、记录 ID、ARIA、disabled 和 SVG 图形不变。
3. 状态色 CSS 必须同时匹配 `.is-minimal-ui` 和可点击关系按钮。
4. 使用现有语义 token：
   - hostile：danger
   - dislike：warning
   - neutral：中性 control/border/text
   - like：accent
   - trust：success
5. 保持 44px 命中区和 24px 可见节点；颜色不是唯一识别渠道。
6. focus-visible 和 disabled 最后生效，hover/active 不得覆盖五档差异。
7. 若实底对比不足，改用中性表面配合语义色图标/描边，不新增裸颜色。

**验收：** 五档状态明显可辨、主题一致；重绘后 data-status、SVG 和 ARIA 同步；普通模式不变。

### 阶段 E：统一日历五类“XX设置”summary 结构

1. 在 `src/calendar-view.js` 引入现有 `CHEVRON_DOWN_ICON_SVG`。
2. 提取轻量 summary 渲染函数，统一输出：
   - 可见标题文字
   - `aria-hidden="true"` 的箭头容器
   - 现有 SVG 图标
3. 五个分支全部复用该结构，避免日历设置、天气设置、生理期设置、菜谱设置、穿搭设置再次漂移。
4. 继续使用原生 `<summary>` 作为唯一交互入口，不增加重复按钮或额外 click handler。
5. 不手工添加 `aria-expanded`；展开状态由 `<details open>` 原生暴露。

**验收：** 五类 summary DOM 配方一致，点击文字或箭头所在区域均由原生 summary 完成展开，展开状态保存逻辑不变。

### 阶段 F：日历设置入口留白与可点击提示

1. 将 `.pm-calendar-management>summary` 统一为 flex 布局，文字与箭头两端对齐，并使用 `gap:var(--pm-space-2)`。
2. 使用 `min-height:var(--pm-size-control-default)` 保证 44px 主触控高度；padding 只使用公共 space token。
3. 移除或覆盖天气 summary 的单独紧凑字号/间距配方，使五类入口一致。
4. 为 `.pm-calendar-management-content` 增加 `padding-top:var(--pm-space-2)`，只在展开内容实际显示时形成“标题 → 首个模块”的 8px 结构留白。
5. 不给首个卡片再加 margin-top，避免双重间距；保留各设置卡之间现有 block margin。
6. 箭头使用 `currentColor`，关闭时向下，`.pm-calendar-management[open]` 时旋转 180 度。
7. 动效只使用 `--pm-motion-normal` 与 `--pm-motion-ease`；在 `prefers-reduced-motion:reduce` 下取消旋转过渡。
8. 保留现有 focus-visible；补充克制的 hover 文字/箭头颜色反馈，但不得增加高饱和背景或重阴影。

**验收：** summary 与首个下方模块之间有明确但不过量的留白；五类入口都能一眼看出可展开，开闭方向正确，亮暗主题一致。

### 阶段 G：自动化契约

#### 今日风向专项

在 `scripts/check-today-trend.mjs` 中增加：

1. 四模块在 minimalUi=true 时均输出 `is-<module> is-minimal-ui`。
2. 大标题规则统一行高、父级 gap、meter margin 和底部节奏。
3. 简易 head-tools 无负 translate；普通模式原 translate 契约继续通过。
4. 楼层五态、多位数、ARIA、颜色和完整显示继续通过，并增加简易 gap/对齐断言。
5. 四类标题说明间距使用 `--pm-space-3`，event facts 仅在简易模式归零负偏移。
6. 两类简易关系按钮输出五档 data-status。
7. 循环、跨尾首、评价保留、busy 禁用和焦点恢复继续通过。
8. 普通模式不消费简易排版或状态色。

#### 日历专项

在 `scripts/check-calendar.mjs` 中增加：

1. schedule、weather、cycle、recipe、outfit 五类 management 均保留原生 `<details>/<summary>`。
2. 五个 summary 均包含正确标题文字及统一箭头 class/SVG。
3. 关闭态没有 `open`，默认需展开的模式仍按现有规则输出 `open`。
4. summary 使用 flex、44px min-height、标准 gap 与 focus-visible。
5. management content 使用 `padding-top:var(--pm-space-2)`，且首个卡片没有新增顶部 margin。
6. `[open]` 箭头旋转 180 度，reduced-motion 取消 transition。
7. 天气 summary 不再使用独立紧凑配方。
8. 展开状态重绘保持和滚动位置恢复测试继续通过。

#### 公共契约

在 `scripts/check-contracts.mjs` 中锁定：

- 今日风向新增规则必须含 `.is-minimal-ui` 祖先。
- 间距、尺寸、颜色和动效只消费现有 token。
- 日历 summary 保留原生语义和 44px 命中区。
- 不允许新增裸色、裸间距、绝对定位、额外负偏移、`transition:all` 或 `!important` 补丁。

### 阶段 H：构建与验证

按顺序执行：

1. `npm run build`
2. `npm run check:syntax`
3. `npm run check:contracts`
4. `npm run check:today-trend`
5. `npm run check:calendar`
6. `npm run check`
7. `git diff --check`

人工回归：

- 今日风向简易模式开/关。
- 四模块大标题、眉题、统计和楼层五态。
- `#3`、`#12`、`#3000`。
- 四类短/长标题及单/多行说明。
- 事件 active/archived 和四种事件类型。
- 关系五档、连续点击、busy 禁用。
- 日历五种模式的 summary 关闭、展开、重绘保持。
- summary 与首个设置卡的间距。
- 日历箭头关闭向下、展开向上、键盘 Space/Enter、focus-visible。
- 亮色、暗色、自定义主题、320px。
- 普通今日风向模式和日历原有数据交互无变化。

## 6. 实施顺序与阻塞条件

1. 先确定今日风向 `.is-minimal-ui` 层叠位置与日历 summary 统一 DOM 配方。
2. 并行实现今日风向模块头/楼层 CSS与日历 summary DOM/CSS。
3. 增加关系 data-status 后实现状态色。
4. 每阶段同步补专项断言，最后构建 bundle 并跑全量检查。

阻塞条件：

- 若 `.is-minimal-ui` 选择器不能稳定覆盖四模块高特异性规则，先重排同组件 CSS 顺序，不使用 `!important`。
- 若状态实底对比不足，改用中性表面方案后再继续。
- 若日历 summary 新结构破坏原生 details 展开或状态保存，停止并回退 DOM 包装；不得改成自制折叠控制器。

## 7. 风险与控制

1. **今日风向规则泄漏到普通模式**：所有新增 CSS 使用 `.is-minimal-ui`，测试做正反断言。
2. **标题修正退化为位移补丁**：先消除双重间距和负 translate，禁止新增 top/translate/负 margin。
3. **楼层状态高度仍跳动**：同时覆盖 floor 与 floor-cancel，逐项验证五态。
4. **事件追踪被过度统一**：只调整主层级 row-gap 与 facts 起始偏移，保留内部语义差异。
5. **状态色对比不足**：使用现有语义 token，颜色、SVG、ARIA 三通道表达。
6. **日历箭头重复默认 marker**：继续隐藏 `::-webkit-details-marker`，仅输出一个自有箭头。
7. **日历内容间距叠加**：只给 management-content 顶部 padding，不给首个卡片加 margin-top。
8. **天气设置继续漂移**：删除或明确覆盖天气 summary 的独立紧凑规则，并用测试锁定同配方。
9. **动效不适配 reduced-motion**：将新箭头过渡加入已有 reduced-motion 规则。

## 8. 回滚策略

本次不涉及数据迁移，可分组件独立回滚：

### 今日风向

1. 移除 `.is-minimal-ui` 下新增排版与状态色规则。
2. 移除两个简易按钮的 data-status。
3. 回退对应测试并重新构建。

### 日历

1. 将五个 summary 恢复为纯文字原生 summary。
2. 移除箭头、summary flex/触控尺寸和 management-content 顶部 padding。
3. 保留原生 details、状态保存和所有设置数据不变。
4. 回退对应测试并重新构建。

## 9. 完成定义

- [ ] 今日风向所有新增视觉规则只在 `.is-minimal-ui` 下生效。
- [ ] 四模块大标题和楼层五态排列统一且多位数不截断。
- [ ] 四类生成内容标题到首段说明/信息块使用 `--pm-space-3`。
- [ ] 五档关系状态有克制、可访问的主题色区分。
- [ ] 日历五类“XX设置”使用同一 summary 结构和 44px 命中高度。
- [ ] 日历 summary 与首个下方模块之间使用 `--pm-space-2` 留白。
- [ ] 日历箭头关闭向下、展开向上，reduced-motion 下无过渡。
- [ ] 原生 details 语义、展开状态保存、滚动恢复和数据操作无回归。
- [ ] 普通今日风向模式保持不变。
- [ ] 构建、语法、契约、两项专项、完整检查与 `git diff --check` 全部通过。
