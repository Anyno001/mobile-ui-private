## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 收敛内置主题右气泡与强调色实底按钮的可访问前景契约，并保留自定义气泡对比度兜底  `#accent-foreground-contract`
- [ ] 补齐独立验收指出的主题配色不变、持久化边界、focus/disabled、动作与字段透传证据并复验  `#acceptance-remediation`
- [x] 确保所有主题色实底按钮使用白色文字且不改动既有主题背景色  `#all-accent-button-white-text`
- [x] 让所有恰好两个并排按钮的操作区等分平铺可用宽度，不再左侧收缩  `#all-two-button-fill`
- [x] 构建 index.js，执行语法、行为、契约、今日风向与全量门禁，并检查 diff  `#build-and-gates`
- [x] 降低生成联系人界面三个按钮的字体粗细  `#contact-generator-button-weight`
- [x] 补充主题、按钮配方、双按钮 DOM 顺序和窄屏边界的行为与契约断言  `#contract-tests`
- [x] 让所有可输入控件聚焦时显示加粗且跟随主题色的边框提示  `#editable-focus-accent-ring`
- [ ] 在真实宿主回归五套主题、亮暗模式、聊天、普通/极简今日风向、320px 与键盘状态  `#host-visual-regression`
- [x] 为势力图谱资料添加/删除控件建立稳定语义 class，并统一编辑器按钮配方与状态  `#today-trend-detail-buttons`
- [x] 建立仅限两个并列操作的共享布局契约，规范次操作在左、保存/提交主操作在右  `#two-button-save-order`
- [x] 将所有外显提示词输入或展示文本统一为13px  `#visible-prompt-font-size`
<!-- LIMCODE_TODO_LIST_END -->

# 统一主题色前景、今日风向编辑按钮与双按钮保存布局

## 修订原因

实施前对现有主题背景进行了实际对比度计算。`docs/CSS-TOKENS.md:95` 要求普通文字至少 4.5:1，并明确“填充按钮不能默认一律使用白字”。现有主题色与白字的结果为：

- 默认蓝 `#1677d2`：4.562:1，通过；
- 暗夜紫 `#5856d6`：5.650:1，通过；
- 柔粉日间 `#E7A9B9`：1.949:1，失败；
- 柔粉夜间/强调色 `#FFC4D4`：1.490:1，失败；
- 薄荷日间/强调色 `#9FBE8C`：2.055:1，失败；
- 薄荷夜间 `#B6D39D`：1.641:1，失败；
- 磨砂强调色 `#6FAEDA`：2.402:1，失败。

因此，原计划中“保留现有背景 + 五套主题右气泡统一白字 + 新增 4.5:1 断言”三者不能同时成立。直接把 `pink.rightText` 和 `mint.rightText` 改为白色只会制造可机器证明的可访问性回归，不能按生产标准实施。

## 待助手确认的决策门

二选一：

1. **保留现有主题配色（推荐最小风险）**：右气泡和填充按钮继续按实际背景选择高对比前景；默认蓝/暗夜紫可用白字，柔粉/薄荷/磨砂使用满足 4.5:1 的深色前景。补齐对比度机器断言，但不承诺所有主题都是白字。
2. **白字为硬要求**：调整柔粉、薄荷、磨砂的右气泡及强调色实底背景，使白字达到 4.5:1。该方案会改变主题视觉身份，并影响所有消费 `--pm-color-accent` 的组件，必须作为明确批准的配色变更实施和回归。

在决策确认前，不修改 `src/config.js` 的主题前景，也不伪造会失败的 4.5:1 断言。

## 决策确认后的实施顺序

### 1. 主题色前景契约

- 按确认方案修改 `src/config.js`，保留 `src/phone-theme.js` 中显式自定义气泡走 `contrastText()` 的路径。
- 不修改持久化 schema、版本或存储键。
- 在 `scripts/check-behavior.mjs` 增加五套主题的前景与 4.5:1 断言。
- 在 `scripts/check-contracts.mjs` 固定 `--pm-r-bg/--pm-r-txt` 写入边界，以及强调色实底按钮必须使用对应 `on-*` 前景。

### 2. 势力图谱资料按钮

- 为资料行、添加资料、删除资料增加稳定语义 class；动态插入模板同步使用相同 class。
- 添加资料使用 control 表面、primary 文字、default 描边和标准触控高度。
- 删除资料使用次级危险语义，不使用大面积危险实底。
- 保留数量上限、disabled 和既有 `data-action` 行为。

### 3. 双按钮保存区

- 仅为恰好两个并列操作的容器增加显式共享 class。
- 将世界态势、个人风评、势力图谱编辑器的 DOM 顺序改为“取消在前、保存/提交在后”。
- 不使用 CSS `order`，确保 DOM、视觉和 Tab 顺序一致。
- 不影响单按钮、三按钮、工具栏及非保存型双按钮。

### 4. 机器门禁与构建产物

- 补齐主题前景、资料按钮语义、DOM 顺序、focus-visible、disabled 和 320px 边界断言。
- 运行 `npm.cmd run build`、`check:syntax`、`check:behavior`、`check:contracts`、`check:today-trend`、全量 `check` 与 `git diff --check`。
- 确认 `index.js` 实际包含变更；区分既有基线债务与本轮新增失败。
- 最后调用独立验收专家；存在 blocking/major 时修复并复验。

### 5. 真实宿主回归

- 回归五套主题、亮暗模式、单聊/群聊、普通/极简今日风向、320px、键盘焦点和 disabled。
- 当前环境缺少真实 SillyTavern 宿主时，如实保留为未闭环风险，不伪报完成。

## 回滚边界

- 主题前景/背景、资料按钮 class/CSS、双按钮 DOM 顺序均分阶段独立回滚。
- 每次回滚后重新构建 `index.js` 并运行同一组门禁。
- 全程不触碰业务数据模型和持久化格式。
