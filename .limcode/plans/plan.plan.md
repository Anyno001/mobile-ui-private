## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 修复业务模块（今日趋势、日历、设置）的图标层级  `#fix-business-css`
- [x] 修复 styles/community.css 中的图标默认颜色层级  `#fix-community-css`
- [x] 修复 styles/core.css 中的图标默认颜色层级  `#fix-core-css`
- [x] 重写 resolveThemeAuxiliary 函数废除旧算法  `#rewrite-aux-logic`
- [x] 更新 src/config.js 中的 THEME_PRESETS 的辅助色  `#update-presets`
<!-- LIMCODE_TODO_LIST_END -->

# UI 色彩系统收敛与层级修复计划

## 1. 计划目标与背景
当前的 UI 主题系统存在两个严重的设计问题，导致界面视觉灾难：
1. **辅助色（Auxiliary）滥用互补色**：`THEME_PRESETS` 为所有主题分配了跨度 180 度的强对比色（如蓝配褐、粉配深青）。
2. **状态颜色层级错乱**：原本应为次要层级（Tertiary）的未激活图标（如省略号、拍一拍手势、顶部辅助图标）被错误地赋予了辅助色（Auxiliary），导致视觉焦点涣散。

本计划将收敛 JS 中的主题色分配逻辑，并全面修复 CSS 中错误高亮的图标层级。

## 2. 影响范围
- **核心逻辑**：`src/config.js`（重构预设颜色和动态计算逻辑）
- **样式文件**：
  - `styles/core.css`
  - `styles/community.css`
  - `styles/today-trend.css`
  - `styles/calendar.css`
  - `styles/modal-settings.css`

## 3. 任务拆解与实施步骤

### 阶段 1：重构主题辅助色算法与预设
- [ ] **更新 `src/config.js` 中的 `THEME_PRESETS`**：将 `auxiliary` 字段从互补色修改为主色的同色系（Monochromatic）或邻近色（Analogous）。
  - `default`: `#B85C19` -> `#005CBF`
  - `dark`: `#A85A00` -> `#64D2FF`
  - `pink`: `#287C78` -> `#E07A93`
  - `mint`: `#7C476D` -> `#739E59`
  - `frost`: `#A94F3D` -> `#4B8EC4`
- [ ] **重写 `resolveThemeAuxiliary` 函数**：废除现有的 HSL 强对比互补色计算。如果用户使用自定义色，直接回退到该预设原本的辅助色，或者不作生硬的色相偏转，保持视觉稳定。

### 阶段 2：修复基础组件的色彩层级
- [ ] **`styles/core.css`**：
  - 将 `.pm-header-icon-button` 的默认 `color` 从 `var(--pm-color-auxiliary)` 降级为 `var(--pm-color-text-tertiary)`，并在 `:hover` 时切换为 `auxiliary`。
  - 将 `.pm-name-edit`（编辑名称笔图标）及 `.pm-expand-btn` 恢复为灰度/次要色。
  - 将 `.pm-quote-preview-cancel`（引用预览取消）降级。

### 阶段 3：修复社区互动与业务模块的色彩层级
- [ ] **`styles/community.css`**：
  - 降级 `.pm-scene-post-more`、`.pm-scene-more`（省略号图标）。
  - 降级`.pm-scene-post-actions button`（点赞、评论等操作底栏按钮）默认状态。
  - 降级 `.pm-scene-title-poke`（拍一拍小手），使其默认灰度，只有在 active/focus 时点亮。
  - 降级 `.pm-scene-view-actions button`（场景视图操作区）。
- [ ] **`styles/today-trend.css`**：
  - 降级 `.pm-today-trend-header button` 和 `.pm-today-trend-icon-button`。
- [ ] **`styles/calendar.css`**：
  - 降级 `.pm-calendar-detail-more`（日历详情省略号）。
- [ ] **`styles/modal-settings.css`**：
  - 降级 `.pm-header-autogen`（自动生成按钮）的默认色彩。

## 4. 验收标准
1. **视觉和谐**：各预设主题下的开关、复选框、高亮边框不再刺眼，回归主题色的同色系。
2. **层级正确**：所有的省略号、未点击的互动按钮（点赞、拍一拍）在默认状态下呈现次要文本色（Tertiary），只有鼠标悬停或激活（选中）时才显示辅助色或主色。
3. **回归测试**：确保自定义主题输入不会因为算法废除而抛出异常。

## 5. 回滚策略
本次修改仅涉及 CSS 变量映射和单纯的视觉逻辑，如遇样式覆盖问题或用户反馈色彩过暗，可直接使用 Git 回滚 `src/config.js` 和 CSS 文件，不会影响业务状态数据。
