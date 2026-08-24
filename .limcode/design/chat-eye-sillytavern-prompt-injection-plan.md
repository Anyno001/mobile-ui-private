# 聊天眼睛触发世界书扫描的修复设计

## 目标

修复联系人/群聊切换器的眼睛所选聊天记录无法触发 SillyTavern 世界书的问题。

眼睛的既有语义不变：选择该会话、根据聊天注入设置的**位置**和**深度**把其历史登记到 SillyTavern Extension Prompt；下一次酒馆正文构建时，世界书应能扫描该注入文本并激活匹配条目。

## 已核实的实际链路

1. 点击眼睛，`src/phone-directory.js:298-303` 调用 `__pmToggleConversationInjection()`。
2. `src/phone-context-injection.js:121-138` 更新 `ST_SMS_BIDIRECTIONAL` 并立即 `await applyBidirectionalInjection()`。
3. `src/phone-injection.js:272-301` 从已选会话历史构建 phone prompt；`src/phone-injection.js:103-108` 正确读取设置中的 position/depth。
4. `src/constants.js:25-30` 的位置枚举与 SillyTavern release 一致：`IN_PROMPT=0`、`IN_CHAT=1`、`BEFORE_PROMPT=2`。
5. 上游 SillyTavern release 的 `setExtensionPrompt(key, value, position, depth, scan=false, role=SYSTEM, filter=null)` 将第五参数定义为是否将该 Extension Prompt 纳入 World Info 扫描；`st-context.js` 对外暴露的就是这个函数和 `extensionPrompts`。
6. 当前项目在 `src/phone-injection.js:83` 固定调用：
   ```js
   context.setExtensionPrompt(prompt.key, prompt.content, prompt.position, prompt.depth, false, 0);
   ```
   因此 phone 聊天历史即使被登记，仍被明确标记为**不参与世界书扫描**。

## 根因

根因不是注入深度不存在，也不是手机独立 API 或 `ai.js`。

- position/depth 已经从设置传到宿主调用；
- role `0` 对应 system，也没有错；
- **错在第五参数硬编码为 `false`**。这切断了“聊天记忆注入 → 世界书扫描 → 世界书条目进入正文”的链路。

因此，若观察点是“由聊天内容命中的世界书条目没有进入后端请求”，现象与代码完全一致：世界书从未被要求扫描这段聊天内容。不能把这一点误判为所有 Extension Prompt 都没写入。

## 最小修复

仅调整 phone 来源：

1. 在 `buildContextInjectionPrompts()` 生成的 `phoneItems` 上声明 `scan: true`；
2. `replaceExtensionPrompts()` 使用每个 prompt 的 `scan === true` 作为第五参数；未声明的来源继续传 `false`；
3. 位置、深度、system role、预算、历史范围、key 和持久化 schema 均保持不变；
4. 不修改 `src/ai.js`、手机短信生成、独立 API、社区、日历、菜谱、穿搭、今日风向。

这样只有眼睛选中的 phone 聊天内容进入 World Info 扫描，避免把其他来源的既有隐私/上下文语义无故改掉。

## 验证

### 自动化

在现有权限/注入契约测试中断言：

- phone prompt 调用的第五参数为 `true`；
- position/depth 保持传入设置值；
- community、calendar、todayTrend 仍为 `false`；
- 清理调用行为不变。

### 真实宿主

1. 给一个 phone 会话写入唯一世界书关键词；
2. 点亮眼睛；
3. 使用 SillyTavern 原生正文生成；
4. 确认匹配世界书条目出现在请求/提示词检查视图中；
5. 熄灭眼睛后重新生成，确认该条目不再由该 phone 会话触发。

## 不做的事

- 不把 Extension Prompt 拼入 `ai.js`；那是另一条手机生成链。
- 不新增设置、诊断、持久化字段或大范围事务重写；它们不能修复一个已确定的布尔参数错误。
- 不宣称能仅靠仓库测试验证服务端 payload；自动化测试验证对宿主 API 的正确调用，真实酒馆验证世界书实际消费。