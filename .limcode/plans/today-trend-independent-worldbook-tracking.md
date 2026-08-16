## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 补齐 worldbook、today-trend、权限和 UI 契约测试，覆盖通用 NPC 群像、独立读取、隐私边界、无正文 prompt、事件连续性与普通模式不回归。  `#tt-independent-contract-tests`
- [x] 为初始化与增量生成加入通用 NPC 群像独立推演契约，让楼层仅作为逻辑时间刻度，并用现有 dynamics 持续追踪 NPC 个体、群体与组织。  `#tt-independent-generation-contract`
- [x] 保持现有 pendingTurns、intervalFloors、assistant checkpoint、generationSnapshots 与聊天回退语义，补齐独立模式的触发和迟到结果保护。  `#tt-independent-scheduler-rollback`
- [x] 冻结现有 todayTrend 生成、世界书筛选、楼层调度、快照回退、设置 UI 与测试基线，确认目标是通用 NPC 群像而非粉丝专属系统。  `#tt-independent-scope-baseline`
- [x] 仅调整今日风向来源与自动调用说明，明确关闭正文后的世界书 NPC 群像推演和“每 N 楼”逻辑时间含义，不新增设置或视觉体系。  `#tt-independent-ui-copy`
- [x] 运行构建、语法、专项、全量、差异化基线和 git diff 检查，记录 NPC 群像人工推演回归与既有失败。  `#tt-independent-validation`
- [x] 扩展世界书读取的显式激活模式，使 includeExistingChat=false 时读取已选且获 todayTrend 权限允许的世界书内容，不依赖聊天关键词。  `#tt-independent-worldbook-context`
<!-- LIMCODE_TODO_LIST_END -->

# 今日风向 NPC 群像独立时间追踪实施计划

## 1. 需求解释与范围

“粉丝有自己的生活”只是一个例子。真正目标是：**世界书中存在的 NPC 个体、群体和组织，都可以在今日风向的时间追踪中拥有不依附聊天正文的持续发展。**

NPC 群像可以包括但不限于：

- 粉丝、站姐、后援会、普通观众；
- 同事、同学、家人、邻居、店员、居民；
- 媒体、论坛用户、行业从业者、社团成员；
- 势力成员、组织分支、地方团体、竞争者和合作方；
- 世界书定义的其他个人、匿名群体或机构。

实现必须保持通用，不能在 schema、prompt、UI 或测试里把“粉丝”固化成唯一业务对象。

### 本轮目标

在现有 `todayTrend` 内，让用户关闭“参考当前已有正文”后：

1. 聊天正文不进入生成 prompt；
2. 已选世界书条目的激活不再依赖聊天关键词；
3. AI 依据世界书、角色资料和当前今日风向状态，推进 NPC 个体、群体与组织的场外发展；
4. NPC 生活线继续用现有 `dynamics.active/archived`、`participants`、`origin`、`stages` 和 `relatedEventIds` 表达；
5. 自动推进继续以助手楼层作为逻辑时间刻度，并保留快照、聊天回退和迟到结果保护。

### 明确不做

- 不新增 `fanLife`、`npcLife` 或其他独立 store、版本号、备份字段和分支数据模型。
- 不为粉丝或其他 NPC 类型增加专属 schema。
- 不建立全局 NPC 档案、属性、资源、关系或目标数据库；本轮只增强已有事件追踪的群像连续性。
- 不引入现实时间后台任务、`setInterval`、浏览器关闭期间的离线生成或墙钟补算。
- 不自动把 NPC 事件发布为社区帖子、评论或弹幕。
- 不修改今日风向关系状态、视觉模式、正文注入和既有社区数据模型。
- 不让自动推演改写世界书、世界预设规则、已归档事件或既有事件基础资料。

## 2. 已验证现状

### 2.1 已具备的能力

- `includeExistingChat=false` 会清空 `mainChatText/latestChatText`：`src/today-trend-context.js:6-35`。
- 空的 `main_chat_data` 会被 prompt `block()` 过滤：`src/prompts/today-trend/envelopes.js:3-8,21-28,46-57`。
- 增量生成已经接收世界书、角色资料、当前四模块状态和动态规则：`src/prompts/today-trend/envelopes.js:47-56`。
- 动态事件已有生命周期、参与者、起因、阶段历史、结果、关联事件与时间戳：`src/today-trend-model.js:114-143,216-241`。
- 生成验证器保护归档事件、事件类型和阶段前缀，只允许连续追加实际进展：`src/today-trend-generation.js:159-221`。
- 单事件推进不得修改基础资料、其他事件或事件总量：`src/today-trend-generation.js:113-129`。
- 自动推进已有 `pendingTurns`、`intervalFloors`、checkpoint、快照和聊天回退：`src/today-trend-scheduler.js:205-310,312-423`。

### 2.2 当前缺口

1. 世界书读取仍以最近聊天消息作为关键词扫描语料：`src/worldbook-context.js:15-20,56-121`。关闭正文只阻止正文进入 prompt，不能让非 constant 世界书条目独立参与推演。
2. prompt 没有区分“正文关联模式”和“世界书独立模式”，模型可能把楼层数误解为发生过相应正文剧情：`src/prompts/today-trend/envelopes.js:56`。
3. prompt 没有明确要求 NPC 群像拥有不围绕目标角色的连续因果线，容易出现每轮重建陌生事件、所有事件都服务主角或硬造突发新闻。
4. UI 文案只写“参考当前已有正文”和“每 N 楼执行一次”，没有解释关闭正文后的世界书独立推演语义：`src/today-trend-view.js:28`、`src/today-trend-settings-view.js:9`。

## 3. 核心设计决策

### 3.1 保持现有持久化 schema

继续使用：

- `preset.source.worldBookNames`
- `preset.source.includeExistingChat`
- `scope.operation.intervalFloors`
- `scope.operation.lastSuccessfulAssistantCount`
- `scope.generationSnapshots`
- `scope.dynamics.active/archived`

`TODAY_TREND_VERSION` 保持 `1`，不增加字段，不修改备份和分支继承格式。

`includeExistingChat=false` 的扩展语义为：

> 正文既不进入 prompt，也不参与已选世界书条目的激活。今日风向依据明确选择、且获 `todayTrend` 权限允许的世界书资料与当前追踪状态独立推演 NPC 群像。

这复用已有用户设置，不再堆一个语义重复的持久化开关。

### 3.2 世界书增加调用级激活模式

为通用世界书读取链增加非持久化参数，例如：

```text
activationMode: 'chat' | 'selected'
```

- `chat`：默认行为。constant 条目始终匹配，其他条目由可见聊天关键词触发。
- `selected`：仅在调用方显式提供 `bookNames` 时使用；已选择书中的条目不要求聊天关键词命中。

`selected` 只改变“条目是否需要关键词命中”，不得绕过：

- 世界书总开关；
- entry override；
- column/module 权限；
- scope 权限；
- 成员私有记忆隔离；
- 宿主禁用条目的插件接管规则；
- 顺序、字符预算和 AbortSignal。

调用链：

```text
gatherTodayTrendContext
  -> gatherContext / collectHostContext
     -> buildWorldBookContext({ module: 'todayTrend', bookNames, activationMode })
```

`includeExistingChat=true` 使用 `chat`，`false` 使用 `selected`。禁止通过伪造 chat message 绕过现有扫描器。

### 3.3 NPC 群像复用 dynamics，而不是硬编码类型

`dynamics` 事件应支持任意世界书支持的主体：NPC 个人、群体、组织或机构。实现不新增 `fan`、`resident`、`coworker` 等枚举。

事件字段职责：

- `participants`：稳定记录参与的 NPC 名称、群体名或组织名；
- `origin`：记录事件成立的世界设定与初始动因；
- `stages/latestStage`：追加 NPC 自身生活、工作、关系、资源或组织行动的进展；
- `relatedEventIds`：表达不同 NPC 线之间的相互影响；
- `active/archived`：表达持续发展和结束结果。

prompt 契约必须要求：

1. NPC 线可以与目标角色无直接互动；不能把所有发展都强行围绕目标角色。
2. NPC 类型只能从世界书和当前状态推导，不得默认世界里必然存在粉丝、媒体、学校或组织。
3. 既有 active 事件优先连续推进，保留 ID、type、origin、participants 和阶段历史。
4. 新事件必须有世界书或现有状态依据，并与当前活跃事件数量、追踪上限相协调。
5. 普通生活变化优先使用 `normal`；`incident/rumor/underground` 继续受现有开关、概率与验证器限制。
6. 没有合理进展时模块输出 `null`；不能为了表现 NPC“活着”而强制制造事故或无意义阶段。
7. 不得声称未提供的聊天剧情已经发生。

### 3.4 楼层是逻辑时间，不是内容来源

保留现有 scheduler 语义：

- `pendingTurns` 累计宿主楼层；
- `intervalFloors` 控制自动推进频率；
- 只有助手消息完成后才尝试自动运行；
- `lastSuccessfulAssistantCount` 是楼层 checkpoint；
- `generationSnapshots` 支持随聊天回退；
- 定向刷新不推进 checkpoint。

关闭正文后，楼层只回答“何时再推进一次”，不能作为“发生了哪些剧情”的证据。

本轮实现的是**内容来源独立**，不是**触发器脱离聊天活动**。如果以后要求长期不聊天时也按现实时间推进，应另立需求，处理后台限制、费用预算、休眠恢复和时间漂移。

## 4. 实施步骤

### 4.1 冻结基线和最小修改范围

1. 检查当前工作树，隔离尚未提交的今日风向视觉修改。
2. 精确复核 `buildWorldBookContext`、`gatherContext/collectHostContext`、`gatherTodayTrendContext`、generation controller、scheduler、rollback 和全部测试调用方。
3. 记录现有 `check:behavior`、`check:permissions`、`check:contracts` 基线失败，后续用 detached HEAD 做归一化差分。
4. 确认本轮不修改 store version、备份、分支继承、community 或 interactive 数据。

### 4.2 实现已选世界书独立激活

**预计修改：**

- `src/worldbook-context.js`
- `src/host-context.js`
- `src/today-trend-context.js`

步骤：

1. 给 `buildWorldBookContext` 增加严格枚举 `activationMode`，默认 `chat`；非法值明确报错。
2. 将条目激活判定整理为可测试规则：
   - constant 始终匹配；
   - `chat` 保持当前可见聊天关键词匹配；
   - `selected` 在显式 `bookNames` 范围内不要求关键词。
3. `selected` 未提供非空 `bookNames` 时安全拒绝，不能退化为读取所有可见世界书。
4. `host-context` 仅透传参数，不改变其他模块默认行为。
5. `gatherTodayTrendContext` 根据 `includeExistingChat` 选择模式，返回结构保持不变。
6. 保持单本读取失败不阻断其他书、字符预算稳定截断和 AbortError 传播。

### 4.3 加入通用 NPC 群像生成契约

**预计修改：**

- `src/prompts/today-trend/envelopes.js`
- 必要时 `src/today-trend-context.js` 增加非持久化派生说明

步骤：

1. 初始化和增量 prompt 明确当前是“正文关联模式”还是“世界书独立模式”。
2. 独立模式声明：聊天正文没有作为事实输入；楼层数只是逻辑时间刻度。
3. 用“NPC 个体、群体与组织”描述通用群像；粉丝只能作为示例之一，不得成为默认或必选类别。
4. 要求 NPC 事件可拥有与主角无关的持续因果，但必须符合世界书和当前状态。
5. 要求优先推进已有 active 事件、稳定参与者和事件基础资料，只追加实际阶段。
6. 保留 `null = unchanged`，不强制每轮更新四个模块。
7. 不增加输出字段，不改 parse/normalize schema，不放宽现有事件验证器。

### 4.4 锁定 scheduler、快照和回退

**预计以测试为主；没有证据不修改 scheduler。**

验证：

1. 两种来源模式共用同一 `run()`、committer、late-result guard 和 refresh rollback。
2. 自动生成仍只在 `pendingTurns >= intervalFloors` 时启动一次。
3. 多个宿主事件只排一次 observation，不重复调用 AI。
4. 手动完整生成推进 checkpoint；定向刷新不推进 checkpoint。
5. 聊天楼层下降时恢复最近 snapshot，并裁剪已消失楼层后的 NPC 群像进展。
6. preset revision、scope 或 storageId 在生成期间变化时丢弃迟到结果。
7. 独立模式不放宽 archived、active、type、stage history 和单事件基础资料约束。

### 4.5 调整 UI 说明，不增加配置

**预计修改：**

- `src/today-trend-view.js`
- `src/today-trend-settings-view.js`
- `scripts/check-today-trend.mjs`

文案：

- 保留“参考当前已有正文”开关；补充“关闭后，将依据已选世界书、角色资料和当前追踪状态独立推演 NPC 群像”。
- 将“自动调用：每 N 楼执行一次”改为“逻辑时间：每 N 楼推进一次”，说明楼层只决定推进时机。
- 不写“粉丝模式”“粉丝生活”等专属词，不新增表单字段、CSS class 或视觉组件。

若后续实际需要改 DOM/class/CSS，必须先重新读取 `docs/CSS-TOKENS.md` 与 `docs/BASELINE.md`；单纯文字变更不得顺手调整视觉。

## 5. 测试与契约

### 5.1 `scripts/check-behavior.mjs`

补充通用世界书读取测试：

1. 默认 `chat` 模式保持关键词和 constant 行为；
2. `selected` 模式无需聊天关键词即可读取显式选择书的允许条目；
3. 未选书不会读取；
4. book、entry、column、module 和 scope 关闭仍生效；
5. 成员私有记忆不会因 `selected` 泄漏；
6. host-disabled 普通条目和插件接管栏目保持原规则；
7. 顺序、maxChars、单书失败和 abort 无回归；
8. 非法模式和 selected 缺失 bookNames 可诊断。

### 5.2 `scripts/check-today-trend.mjs`

补充：

1. `includeExistingChat=false` 时上下文收集使用 selected activation；
2. `mainChatText/latestChatText` 为空，prompt 不出现 `main_chat_data`；
3. 世界书内容仍进入 prompt；
4. prompt 明确楼层是逻辑时间，禁止推断未提供的正文剧情；
5. prompt 使用通用 NPC 群像语义，不要求粉丝或任何固定 NPC 类型；
6. 合法的 `normal` NPC 事件可被创建和连续推进；
7. 既有事件的 ID、origin、participants 与 stage 前缀保持稳定；
8. archived 改写、阶段截断、事件类型改写、无权限 incident 和单事件基础资料改写继续拒绝；
9. 自动 N 楼、补调度、迟到结果、回退和分支复制既有断言继续通过；
10. UI 字段不变，并出现新的通用说明文本。

### 5.3 权限与公共契约

- 在现有 worldbook 权限 fixture 中验证 selected 只改变关键词激活，不绕过权限矩阵。
- 若 `scripts/check-permissions.mjs` 已覆盖 todayTrend column 权限，在原测试处扩展；不复制权限实现。
- 纯 prompt 和文案契约放在 `check-today-trend`；只有公共调用签名和模板结构需要时才修改 `check-contracts`。

## 6. 验证顺序

1. `npm run build`
2. `npm run check:syntax`
3. `npm run check:today-trend`
4. `npm run check:behavior`
5. `npm run check:permissions`
6. `npm run check:contracts`
7. `npm run check`
8. `git diff --check`

既有全量失败必须和 detached HEAD 做归一化输出差分；只允许把增量为零的失败归为基线债务。

### 人工回归

- 使用不包含粉丝设定、但包含居民/同事/组织的世界书，关闭正文后能生成对应 NPC 群像事件。
- 使用包含粉丝的世界书时，粉丝可以出现，但不会排挤其他 NPC 类型或成为固定模板。
- 同一 active 事件跨多次推进保持 ID、参与者、起因和阶段历史。
- NPC 事件可以与目标角色无直接互动，但不违反世界书。
- 开启正文后，原有正文关联和关键词扫描行为不变。
- 自动每 N 楼只推进一次；连续宿主事件不重复生成。
- 回退楼层后 NPC 群像状态恢复到对应 snapshot。
- 无合理进展时允许输出 null，不强制制造事件。

## 7. 风险与控制

| 风险 | 后果 | 控制 |
| --- | --- | --- |
| 把粉丝例子硬编码成领域对象 | 其他 NPC 无法受益，世界类型被错误限定 | prompt、UI、测试统一使用 NPC 个体/群体/组织；不新增 fan schema |
| selected 读取内容过多 | 上下文拥挤、后部条目被截断 | 只读明确选择书，保持顺序和 maxChars |
| 独立模式泄漏禁用或私有内容 | 权限越界 | 不绕过 `isWorldBookEntryAllowed` 和 private-memory 分支，补权限测试 |
| 所有 NPC 仍围绕主角 | 群像独立性名存实亡 | prompt 允许与目标角色无直接互动，并要求 NPC 自身连续因果 |
| 每轮重建新 NPC 和新事件 | 状态膨胀、生活线不连续 | 优先推进 active，稳定 ID/participants/origin，保留 trackingLimit |
| 楼层被误当剧情事实 | 编造正文中不存在的事件 | 明确楼层仅是逻辑时间刻度，正文块为空时禁止推断正文 |
| 强制“活跃”造成无意义事件 | 内容失真 | 保留 null=unchanged 和 appendOnlyOnActualProgress |
| 通用 worldbook 改动影响其他模块 | chat/calendar/community 回归 | activationMode 默认 chat，其他调用方不传新参数，全量 behavior 回归 |
| 误改持久化边界 | 旧备份和历史损坏 | 不改 schema/version/storage/backup/branch |

## 8. 完成标准

- “粉丝”仅作为 NPC 群像示例，不存在任何粉丝专属模型或流程。
- 关闭正文后，已选世界书的允许条目和 prompt 均不依赖聊天内容。
- 任意世界书定义的 NPC 个体、群体和组织都可通过现有 dynamics 连续发展。
- 楼层调度、快照回退、迟到结果保护、存储和分支继承无回归。
- 权限、成员私有记忆、字符预算和事件不变量没有被绕过。
- 专项断言通过，全量失败增量与 HEAD 完成隔离。
- 交付说明准确区分“内容独立推演”和“现实时间后台运行”。
