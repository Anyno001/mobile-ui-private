<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/baseline-gate-repair.md","contentHash":"sha256:502ddf0970041b32351d313149a14ed95a6181355e96a0bb510c42097fcf019a"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 将 check-behavior 的 auxiliary 期望对齐已确认的同色系实现值，保留 auxiliary 与 accent 不相同的不变量，并通过行为契约。  `#bgr-auxiliary-contract`
- [x] 在日历渲染/注入链增加真实事实源边界，使完全空数据不生成 prompt，同时保留事件、纪念日、节假日、天气和周期数据注入。  `#bgr-calendar-empty-guard`
- [x] 按盘点结果最小修复 CSS 模块/聚合入口/治理 registry；不放宽检查器、不静默忽略失败、不借机重做视觉。  `#bgr-css-governance`
- [x] 基于 CSS-TOKENS、BASELINE、styles 模块和 check-contracts 输出，逐项盘点 style.css 聚合入口、important baseline、legacyValues、未登记值与缺失规则。  `#bgr-css-inventory`
- [x] 冻结本专项范围与基线证据：记录当前工作树、今日风向改动边界和三项门禁失败清单，确保后续 diff 可分离、可回滚。  `#bgr-freeze-baseline`
- [x] 确认临时产物清理、专项 diff 边界、progress/plan 状态和最终工作树，再决定提交或交付。  `#bgr-freeze-delivery`
- [x] 备齐可核实运行证据后调用独立 Acceptance Expert；blocking/major 存在时修复并复验，未收敛不得完成专项。  `#bgr-independent-acceptance`
- [x] 运行 behavior、permissions、contracts 及 build、syntax、today-trend、interactive、diff-check，隔离并记录任何新增失败。  `#bgr-specialized-gates`
<!-- LIMCODE_TODO_LIST_END -->

# 基线门禁专项实施计划

## 1. 来源与已确认事实

本计划基于已确认设计文档：`.limcode/design/baseline-gate-repair.md`。

当前已核实的门禁失败：

- `scripts/check-behavior.mjs:2415` 仍断言旧互补色 auxiliary；源码 `src/config.js` 已使用同色系辅助色，且 `docs/CSS-TOKENS.md` 明确允许相邻色或对比色。
- `scripts/check-permissions.mjs:656` 在空 `calendarStore` 下看到由 `buildCulturalFestivals()` 产生的文化节日，实际生成了日历 prompt；已通过直接调用 `renderCalendarContextInjection()` 复现。
- `npm.cmd run check:contracts` 同时报告未登记/过期 `!important`、legacy CSS 值未对齐、`style.css` 缺失当前模块规则与声明等问题。

当前工作树已有今日风向专项未提交变更。本计划不得覆盖、重写或混入这些变更；基线修复文件必须能通过 `git diff --name-only` 和逐文件 diff 独立识别。

## 2. 目标与边界

### 目标

1. 让 `check:behavior`、`check:permissions`、`check:contracts` 对当前源码和治理基线一致。
2. 保留原有主题、日历注入和 CSS 语义，不通过删除断言、放宽规则或静默吞错制造假绿。
3. 在不改变 todayTrend 存储、调度、备份、分支继承、版本号和数据 schema 的前提下完成全量 gate。

### 不在范围内

- 不修改 `todayTrend` 生成、世界书、scheduler、storage、backup、branch-scope 文件。
- 不恢复已移除的主题互补色算法。
- 不把本轮独立世界书/NPC 群像改动重写为基线修复。
- 不新增第三方依赖，不创建长期临时 runner，不通过 `setInterval` 或后台任务改变运行模型。

## 3. 阶段 A：冻结证据与回滚点

1. 记录当前 `git status --short`、`git diff --stat`、当前 HEAD，以及三项失败的完整输出。
2. 建立“专项允许修改文件”清单。预计包含：
   - `scripts/check-behavior.mjs`
   - `src/phone-injection.js` 与对应权限契约测试
   - `style.css`、必要的 `styles/*.css`、`scripts/css-governance-registry.json`
   - 必要时 `scripts/check-contracts.mjs`，仅限修正检查器对已确认格式的错误解析，不得降低检查强度。
3. 每次修改前保存对应文件的当前内容/差异证据；任何无法与三项基线直接关联的改动停止并重新归类。
4. 失败命令使用 PowerShell + `npm.cmd` 单独执行；不使用 cmd 的 `&&` 连接，首次失败先区分环境故障与代码故障。

**阶段验收**：能明确区分本专项 diff 与既有今日风向 diff；拥有可恢复的工作树快照和可复核失败日志。

## 4. 阶段 B：修复主题 auxiliary 契约

1. 以 `src/config.js` 的五个实际 auxiliary 值和 `docs/CSS-TOKENS.md` 的 auxiliary 语义为事实源。
2. 只更新 `scripts/check-behavior.mjs:2415-2418` 的残留期望值为当前实现值：
   - `default: #005CBF`
   - `dark: #64D2FF`
   - `pink: #E07A93`
   - `mint: #739E59`
   - `frost: #4B8EC4`
3. 保留并执行 `auxiliary !== accent` 断言；不改 `resolveThemeAuxiliary()`，不恢复互补色算法。
4. 单独运行 `npm.cmd run check:behavior`，若进入下一失败点，记录而不是把后续失败误归因于本步骤。

**验收标准**：主题辅助色断言通过，主题 key、气泡色、frost 标记和既有主题 UI 断言不回归。

## 5. 阶段 C：修复空日历 prompt 边界

### 5.1 事实源与边界

`renderCalendarContextInjection()` 当前会把文化节日作为纯计算事实加入 `linesByDate`；当所有真实输入为空时，这一事实绕过“空数据不生成 prompt”契约。开关诊断 `calendarEnabled` 仍必须保持为 `true`，不能用关闭模块来遮蔽问题。

“真实事实源存在”包括至少一种以下条件：

- 当前 scope 有实际 events；
- 当前会话有 occasion 数据；
- holiday cache 对目标年份有实际 entries；
- weather store 有可用 location/forecast；
- cycle store 有启用 subject/profile；
- 其他现有渲染器明确使用的、可产生事实的持久化日历输入。

纯默认注入开关、空 scope、当前日期和自动计算文化节日不算真实事实源。

### 5.2 实施顺序

1. 在 `src/phone-injection.js` 中定位空数据判断的最小位置，优先在文化节日加入前或渲染入口增加事实源判断，避免改动各类事实格式化逻辑。
2. 通过已有模型规范化函数判断源是否真实存在，不直接依赖未规范化对象形状，不把默认 scope 字段误判为数据。
3. 保留 `buildContextInjectionPrompts()` 的 `if (body)` 防线和 `diagnostics.calendarEnabled` 语义；不在上层粗暴把模块标记为 disabled。
4. 补充或收紧 `scripts/check-permissions.mjs` 契约：
   - 完全空 store 不生成 `:calendar:` prompt；
   - 空 store 的 `renderCalendarContextInjection()` 返回空字符串；
   - 有 events 的现有 fixture 仍生成 prompt 并包含事件标题/备注；
   - 现有天气、纪念日、节假日、周期 fixture 仍能进入完整日历正文。
5. 对文化节日边界增加明确测试：空真实数据源不应仅因当前日期命中文化节日而生成 prompt；存在任一真实日历事实源时，文化节日可以作为同一日历正文中的补充事实。

**验收标准**：`npm.cmd run check:permissions` 通过；空数据不生成 prompt，真实事件/其他数据源注入不回归；无新增 store、schema、版本或持久化字段。

## 6. 阶段 D：CSS governance 盘点与最小修复

CSS 修改严格遵守已读取的 `AGENTS.md`、`docs/CSS-TOKENS.md`、`docs/BASELINE.md`：`style.css` 是唯一加载入口；稳定视觉使用已登记语义 token；`BASELINE` 只保护宿主与运行兼容，不为历史视觉债务背书。

### 6.1 先盘点，后修改

1. 以 `styles/core.css`、`styles/modal-settings.css`、`styles/community.css`、`styles/calendar.css`、`styles/today-trend.css`、`styles/overrides.css` 为模块事实源，核对 `style.css` 的导入/聚合方式和顺序。
2. 对 `check:contracts` 当前输出逐项分类：
   - 当前 CSS 中存在、registry 没有的 `!important`：判断是否可移除；必须保留的才加入 registry，并写明 owner/reason/removeWhen。
   - registry 有、当前 CSS 已删除或选择器/值已变更的 stale fingerprint：删除或按当前规则重新登记，不能保留错误历史指纹。
   - `legacyValues` 中 stale/unapproved 的 color/transition/animation/spacing：优先迁移到既有 token；确属宿主兼容或已批准历史边界的才保留登记，并补完整元数据。
   - `style.css:27` padding 仍为 `0 !important`、模块导入/声明缺失：以当前模块 CSS 与文档标准为准修复聚合入口或对应模块规则，不能只改错误消息。
3. 若确认 `check-contracts.mjs` 对 parent/media/keyframes 指纹的序列化与仓库现有 registry 约定不一致，先修正规范化函数并补自测；不得通过忽略 parent、降低匹配精度或跳过 stale 检查规避问题。

### 6.2 实施原则

1. 模块 CSS 是可读、可审查的源文件；`style.css` 只按仓库既有约定同步，不手工制造第二套视觉规则。
2. 不新增裸颜色、间距、动画时长、圆角、阴影或 z-index；优先使用已有 `--pm-*` token。
3. 不删除必要的可访问性覆盖、focus/disabled/mobile 规则来减少 registry 数量。
4. 只有真正必要且稳定的 `!important` 才进入 `importantBaseline`；每条 registry 变更都必须能在当前 CSS 找到唯一对应规则。
5. 对 `style.css`、模块 CSS、registry 的大批量同步，先生成可审查的候选 diff，再逐项检查路径、选择器、属性和值；禁止无证据整文件重写。

**验收标准**：`npm.cmd run check:contracts` 通过，且没有通过放宽检查器、删除核心契约或静默忽略实现的“假绿”；亮/暗色、focus-visible、disabled、移动端和动画降级规则仍存在。

## 7. 阶段 E：专项验证与回归

按依赖顺序执行：

1. `npm.cmd run check:behavior`
2. `npm.cmd run check:permissions`
3. `npm.cmd run check:contracts`
4. `npm.cmd run check:syntax`
5. `npm.cmd run check:today-trend`
6. `npm.cmd run check:interactive`
7. `npm.cmd run build`
8. `git diff --check`
9. 必要时执行完整 `npm.cmd run check`，记录每个脚本 exit code；完整链路失败时先定位首个真实失败，不把后续未执行当作通过。

验证期间保留专项日志，但交付前删除日志和任何临时 runner，并用 `git status --short`、`git diff --name-only`、`git diff --check` 确认无残留。

## 8. 独立验收与收尾

1. 仅在专项代码和测试稳定、运行证据齐全后调用真实 `Acceptance Expert`，提供命令输出、exit code、diff stat、临时产物清理证据和范围边界。
2. 验收输出按 `blocking / major / minor / pass` 处理；存在 blocking/major 时回到对应阶段修复并最多复验 8 轮，未通过不得将 TODO 标记 completed。
3. 验收通过后更新 `.limcode/progress.md`：记录三项债务已修复、全量门禁结果、独立验收结论和剩余风险；同步本计划 TODO。
4. 在提交或交付前再次确认：今日风向功能改动仍保留、基线修复可独立识别、没有修改 todayTrend 的存储/调度/备份/分支边界。

## 9. 回滚策略

- auxiliary：只回滚 `scripts/check-behavior.mjs` 的测试期望变更；不回滚已确认的 `src/config.js` 同色系实现。
- calendar：回滚 `src/phone-injection.js` 和对应测试契约即可恢复原注入实现；不触碰 calendar store schema 或版本。
- CSS：按文件回滚 registry、聚合入口或单个模块；禁止用整体 `git reset --hard`，因为会删除未提交的今日风向改动。若需要比较基线，使用临时副本或针对单文件的精确逆向 diff。
- 若任一修复无法在不改变今日风向范围的前提下收敛，停止并向助手报告阻塞点，不把部分绿灯包装成完成。
