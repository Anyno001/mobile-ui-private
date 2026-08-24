<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/chat-eye-sillytavern-prompt-injection-plan.md","contentHash":"sha256:f00a548372d0f6089751b5450e140528b850225611b65256879e8715de13bad9"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 补充 phone 眼睛注入传递 scan=true、位置/深度不变，且 community、calendar、todayTrend 保持 scan=false 的自动契约测试  `#add-injection-contract-tests`
- [ ] 实施最小修复：phone 眼睛注入传递 scan=true，保留位置、深度及其他来源语义不变  `#apply-chat-scan-fix`
- [ ] 构建并运行相关门禁；在真实 SillyTavern 正文验证选中聊天内容可触发世界书，关闭后不再触发  `#build-and-validate-host-flow`
- [ ] 实现 phone 注入规划与逐 key 宿主写入结果的结构化诊断，禁止私密聊天正文进入日志  `#implement-injection-result-contract`
- [ ] 让眼睛开关在目标 prompt 未生成、未写入或未清理时回滚持久化状态并显示可恢复原因  `#prevent-eye-toggle-false-success`
- [x] 已核实 SillyTavern release 的 setExtensionPrompt 第五参数 scan 为 World Info 扫描开关；真实浏览器回归验证留到实施后执行  `#verify-host-extension-prompt-contract`
<!-- LIMCODE_TODO_LIST_END -->

# 聊天眼睛触发世界书扫描的修复实施计划

## 1. 来源与修复边界

- **来源设计**：`.limcode/design/chat-eye-sillytavern-prompt-injection-plan.md`
- **性质**：修复既有功能回归，不新建注入系统，不改变产品语义。
- **用户契约**：点击联系人/群聊的眼睛，只切换该会话是否作为酒馆正文的聊天记忆来源；点击后插件立即把已有聊天记录登记到 SillyTavern Extension Prompt。下一次原生正文生成时，酒馆应按设置的位置和深度使用该内容，并允许该内容触发世界书。
- **严格不改**：不改点击行为、不改 `ST_SMS_BIDIRECTIONAL`、不改历史范围/预算/位置/depth/schema、不改 `src/ai.js`、手机独立 API、社区、日历、菜谱、穿搭、今日风向。

## 2. 根因证据链

1. 眼睛点击：`src/phone-directory.js:298-303` → `__pmToggleConversationInjection()`。
2. 状态与刷新：`src/phone-context-injection.js:121-138` 更新 `window.__pmBidirectional`、保存并调用 `applyBidirectionalInjection()`。
3. Phone prompt 构造：`src/phone-injection.js:272-301` 读取已选联系人/群聊历史；`src/phone-injection.js:103-108` 已正确传递统一设置的 `position/depth`。
4. 位置枚举：`src/constants.js:25-30` 与 SillyTavern release 一致：`IN_PROMPT=0`、`IN_CHAT=1`、`BEFORE_PROMPT=2`。
5. 上游 SillyTavern release 契约：`setExtensionPrompt(key, value, position, depth, scan=false, role=SYSTEM, filter=null)`；第五参数是是否参与 World Info 扫描。
6. 当前 phone 写入：`src/phone-injection.js:83` 固定传 `false`：
   ```js
   context.setExtensionPrompt(prompt.key, prompt.content, prompt.position, prompt.depth, false, 0);
   ```
7. 因而现状是：聊天内容**可能已经写入酒馆 Extension Prompt**，设置的注入位置和深度也**可能已经生效**；但它被明确标记为不参与世界书扫描。若用户观察的是“手机聊天关键词没有激活世界书条目”，该现象正是这个 false 造成的。

这解释了为什么前一版侦查把问题带到 `ai.js`、独立 API、宿主时序和假成功诊断是错误方向：那些不是本故障的必要条件。问题是一个已有调用中的参数回归。

## 3. 最小实施步骤

### 步骤 A：只给 phone 来源打开 World Info scan

**修改文件**：`src/phone-injection.js`

1. 在 `buildContextInjectionPrompts()` 生成的 `phoneItems` 中增加 `scan: true`。
2. 在 `replaceExtensionPrompts()` 调用宿主 API 时，将第五参数改为 `prompt.scan === true`，保持未声明来源默认 `false`：
   ```js
   context.setExtensionPrompt(
       prompt.key, prompt.content, prompt.position, prompt.depth,
       prompt.scan === true, 0,
   );
   ```
3. 不改变 `clearExtensionPrompts()` 的现有清理参数、key 追踪、位置、depth、role、预算和截断逻辑。
4. 不给社区、日历、菜谱、穿搭、今日风向 prompt 增加 scan；它们继续使用 false。

**验收**：

- phone 写入调用第五参数为 `true`；
- phone 的 position/depth 与设置值完全一致；
- 其他来源第五参数仍为 `false`；
- 眼睛点击和持久化行为无代码路径变化。

### 步骤 B：补最小回归契约

**修改文件**：现有 `scripts/check-permissions.mjs`，必要时 `scripts/check-behavior.mjs`。

1. 在已有 phone 生产写入 fixture 上断言 `productionPhoneWrite[4] === true`。
2. 保留并强化已有 `position`、`depth` 断言，证明不是用 scan 修复时顺手破坏深度语义。
3. 在 community、calendar、todayTrend 的写入 fixture 上断言第五参数仍为 `false`；若当前 fixture 尚未捕获完整参数，只补捕获/断言，不重构测试框架。
4. 补一个“眼睛启用后调用 `applyBidirectionalInjection` 的结果仍走同一写入链”的现有行为断言；不新增另一套状态机。

**验收**：契约测试能在 scan 被误改回 false、位置/depth 被误改、非 phone 来源误开启扫描时失败。

### 步骤 C：构建与真实酒馆回归

1. 按项目命令执行构建、语法检查、相关注入/权限/行为检查，再执行全量 `npm.cmd run check`；Windows 环境逐条执行，避免 `cmd` 的 `&&` 包装问题。
2. 核对 `index.js` 已包含 `prompt.scan === true` 逻辑；只改源码不更新 bundle 不算交付。
3. 在真实 SillyTavern 原生正文中：
   - 准备一个聊天历史，其中包含世界书关键词；
   - 点亮该联系人/群聊眼睛；
   - 确认注入位置和 depth 按设置传入；
   - 生成正文，确认该关键词能触发对应世界书；
   - 熄灭眼睛并刷新/重新生成，确认该手机聊天内容不再作为该来源触发世界书。
4. 若真实酒馆仍不触发，才继续核查目标版本 World Info 配置、关键词扫描范围和实际加载 bundle；不得在没有新证据时扩大修改范围。

**验收**：点亮眼睛后，手机聊天记录既进入 Extension Prompt，又能按现有位置/depth 参与世界书扫描；熄灭后不再触发；其他注入来源无回归。

## 4. 风险与回滚

- 这是单个布尔参数修复，无 schema、迁移、存储或接口破坏，不需要数据迁移。
- 打开 scan 会让 phone 聊天内容参与世界书关键词扫描，可能增加命中条目和上下文 token；这是用户既有功能语义要求，不新增开关。
- phone 内容原本标记为私密，但 scan=true 只改变“是否用于 World Info 检索”，不会把内容直接改写进主聊天历史；真实验收需确认命中范围符合现有世界书配置。
- 如需回滚，只回退 `phone.scan` 和 `prompt.scan === true` 两处逻辑及对应测试断言；既有持久化数据保持兼容。

## 5. 最终验收清单

- [ ] 眼睛点击仍只切换已有注入选择，不直接发起 AI 请求。
- [ ] phone prompt 的 `setExtensionPrompt` 调用使用 `scan=true`。
- [ ] 注入位置和 depth 保持既有设置值。
- [ ] 社区、日历、菜谱、穿搭、今日风向仍使用 `scan=false`。
- [ ] 关闭眼睛后现有清理逻辑不变。
- [ ] 相关测试、全量门禁和构建产物均有真实结果。
- [ ] 真实 SillyTavern 正文中，眼睛选中的聊天内容可触发世界书；关闭后不再触发。
