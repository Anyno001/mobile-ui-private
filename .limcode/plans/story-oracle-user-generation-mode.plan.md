<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/story-oracle-user-generation-mode.md","contentHash":"sha256:b534fb64e464d0d278e5d08b0db81935cd1344043635689b5614861aa69eac95"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 完成独立生产验收与真实 SillyTavern 宿主人工回归  `#acceptance`
- [x] 重建 bundle 并通过全量 npm check、定向检查与 diff 校验  `#build-verify`
- [x] 确认 User 生成模式、全局 User 库、备份 schema 与 UI/CSS 契约范围  `#contract-recon`
- [x] 实现 User Persona 一键复制与复制失败降级  `#copy`
- [x] 实现独立 User 库数据模型、规范化、容量限制与新增/删除语义  `#library-model`
- [x] 实现全局 User 库持久化、只读降级、fallback、串行写入与备份链  `#library-storage`
- [x] 实现剧情助手 User 生成模式、最少必要追问、严格成品协议与成人安全边界  `#mode-protocol`
- [x] 补齐模型、存储、协议、安全、备份与 UI 契约自动化测试  `#tests`
- [x] 实现沿用路线工作台视觉的 User 库、成品卡片与操作交互  `#ui`
<!-- LIMCODE_TODO_LIST_END -->

# 剧情助手 User 生成模式与全局 User 库实施计划

## 1. 计划来源

本计划严格落实已确认设计：

- **来源设计文档**：`.limcode/design/story-oracle-user-generation-mode.md`
- **确认范围**：新增“User 生成”模式；对话式收集素材；生成 User Persona；成品保存到全局共享 User 库；沿用路线工作台布局；提供一键复制；不写入或注入 SillyTavern；允许成人向 User 角色，但露骨成人内容中的角色必须明确为成年人。

本计划不重新讨论已经确认的产品方向。任何实施中发现的源码事实若与设计前提冲突，必须暂停对应阶段、记录证据并修订计划，不能在代码里偷偷改变产品边界。

## 2. 实施边界

### 2.1 必须实现

- `user-generation` 进入剧情助手 UI 模式与历史模式白名单；
- 当前聊天隔离的 User 生成访谈历史；
- 全局共享、独立持久化的 User 成品库；
- `collecting / complete / revision` 受控输出解析；
- 路线工作台式“对话 / User 库”双视图；
- 保存、复制、展开、继续修改、删除；
- IDB、localStorage fallback、只读保护和备份恢复；
- 请求取消、晚返回、解析失败、保存失败、复制失败等异常路径；
- 构建产物和正式独立验收。

### 2.2 明确禁止

- 不写入、切换或覆盖 SillyTavern User Persona；
- 不向主聊天、世界书、角色卡或扩展提示注入 User 库内容；
- 不复用 `StoryPlan` 数据对象、启用状态、推进强度或注入逻辑；
- 不提升 `STORY_ORACLE_STORE_VERSION`，除非另行批准迁移设计；
- 不手工编辑构建产物 `index.js`；
- 不顺手加入头像生成、标签、搜索、JSON 导出、版本比较或模板市场。

## 3. 数据与职责边界

### 3.1 访谈历史

继续由 Story Oracle scope 管理：

```text
storyOracle.scopes[storageId].modes['user-generation']
```

它随当前聊天隔离，避免不同角色聊天的上下文、世界书和访谈素材串线。分支继承是否复制该历史必须跟随现有 Story Oracle scope 规则，并通过实施前侦察确认，不得凭设计阶段推断。

### 3.2 User 成品库

建立独立全局持久化域，推荐模块：

- `src/user-generation-model.js`
- `src/user-generation-storage.js`

推荐键：

- `ST_SMS_USER_GENERATION_V1`
- `ST_SMS_USER_GENERATION_V1_LOCAL_FALLBACK`

推荐数据形状：

```text
{
  version: 1,
  items: UserGenerationItem[]
}
```

User 库不进入 `scopes[storageId]`，不参与路线清理和主聊天注入，也不因当前聊天切换而更换实例。

## 4. 分阶段实施步骤

## 阶段一：确认真实消费链与变更清单

### 任务

1. 搜索并精读以下调用链：
   - Story Oracle 安装和依赖注入入口；
   - `deps.callAI`、`gatherContext` 的真实实现与参数契约；
   - Story Oracle scope 的分支继承行为；
   - 全局备份导出、导入、校验、恢复和键清单；
   - `package.json` 构建、语法、专项与全量检查命令；
   - `scripts/check-story-oracle.mjs`、`scripts/check-contracts.mjs` 与 CSS governance registry；
   - `style.css` 的真实加载链及 `.pm-story-oracle-*` 全部选择器和覆盖规则。
2. 确认唯一授权修改文件，区分源码、测试、生成产物和历史文档。
3. 记录现有基线：模式数、存储版本、Story Oracle 相关测试通过情况、构建产物大小、备份键数量和目标选择器清单。

### 阻塞条件

- 找不到备份消费链时，不得先创建无法备份的持久化键；
- `callAI` 或上下文收集行为与现有设计冲突时，先修订计划；
- 工作区已有不相关改动时，必须确认专项 diff 可分离，禁止覆盖或清理助手的其他工作。

### 验收

- 给出文件路径、符号和调用方证据；
- 形成确定的修改文件清单；
- 现有基线失败与本轮新增失败可区分。

## 阶段二：实现全局 User 库模型

### 任务

1. 在独立 model 模块定义：
   - `USER_GENERATION_STORE_VERSION = 1`；
   - item 数量、标题、摘要、正文、ID、来源消息 ID 等字符和数量上限；
   - `createEmptyUserGenerationStore()`；
   - `normalizeUserGenerationStore()`；
   - `userGenerationItems()`；
   - `addUserGenerationItem()`；
   - `removeUserGenerationItem()`。
2. `UserGenerationItem` 字段固定为：
   - `id`；
   - `title`；
   - `summary`；
   - `content`；
   - `sourceMessageId`；
   - `createdAt`；
   - `updatedAt`；
   - `order`。
3. 稳定排序规则：库显示最新成品优先；存储内部排序必须确定且可重复。
4. 新增时执行内容规范化、ID 去重和容量检查；达到上限时显式拒绝，不删除最旧项。
5. 修订成品默认新增独立 item；不得原地覆盖旧成品。

### 负例

- 非对象、错误版本、空正文、超长正文、重复 ID、非法时间、未来可选字段缺失；
- 同一结果重复点击保存不能产生两个相同 item；
- normalize 不得静默把损坏对象改造成看似有效的空成品。

### 验收

- 纯函数测试覆盖正常数据、旧式缺字段数据、损坏数据、容量上限和重复保存；
- model 不依赖 DOM、当前聊天或 StoryPlan。

## 阶段三：实现独立持久化与备份恢复

### 任务

1. 参照 `story-oracle-storage.js` 的生产契约实现：
   - IDB 优先读取；
   - localStorage fallback；
   - 主数据损坏时只读保护，不覆盖原始数据；
   - 可写句柄；
   - 串行保存队列；
   - `shouldWrite` 晚返回保护。
2. User 库加载与 Story Oracle scope 加载分离；一方损坏不得让另一方进入空白或只读状态。
3. 将新全局存储域纳入真实备份导出、导入、校验和恢复链：
   - 旧备份缺少 User 库字段时兼容为空库；
   - 新备份必须完整包含 User 库；
   - 导入损坏 User 库时拒绝该部分并提供诊断，禁止静默清空；
   - 导出、导入后 item 数、ID、正文和顺序守恒。
4. 不把 User 库加入分支 scope 复制；全局库只有一份。

### 回滚

- 新存储使用独立 V1 键；回滚旧版本时旧 Story Oracle 数据不受影响；
- 回滚不会自动删除新键，避免用户成品丢失；如需清理必须另行提供明确工具或人工步骤。

### 验收

- IDB 正常、IDB 失败、fallback 恢复、双存储失败、损坏主数据、失效写句柄均有测试；
- 旧备份仍可导入，新备份往返守恒。

## 阶段四：增加模式、生成提示词与解析协议

### 任务

1. 在 `STORY_ORACLE_MODES`、`STORY_ORACLE_HISTORY_MODES` 和 `MODE_LABELS` 同步加入 `user-generation` / `User 生成`。
2. 保证：
   - 模式切换后历史读取使用独立槽；
   - 清空当前模式只清 User 生成访谈，不清全局 User 库；
   - 剧情聊天和剧情参谋提示词、解析和路线行为不变。
3. 新增 User 生成系统提示词，只抽取已确认模板的最小字段骨架：
   - 履历；
   - 核心性格和反差；
   - 与目标对象、自己、外人的关系；
   - 他者评价；
   - 可选亲密场景；
   - 作者笔记/使用提示；
   - 极简、成品、进阶三种规格。
4. 提示词要求模型最少必要追问，不输出机械长问卷；成人向内容涉及露骨性设定时必须明确成年人。
5. 实现受控解析器：
   - `collecting`：缺口与单一自然语言问题；
   - `complete`：完整 title、summary、content；
   - `revision`：完整新版本 title、summary、content；
   - 拒绝多区块、未闭合、重复字段、缺 title/content、超限和混合状态。
6. 展示层剥离控制标记；普通说明和问题仍进入消息历史。
7. 生成完成后先形成“待保存结果”，不得在模型返回时静默自动入库；由用户点击保存，符合“提供保存到库”的明确操作语义。

### 异常路径

- 格式损坏：保存普通回复，提示未识别成品，保存按钮不可用；
- 取消、模式切换、聊天切换、页面关闭：旧请求晚返回不得写历史或生成待保存结果；
- User 库只读：仍允许生成和复制待保存结果，但保存按钮禁用并说明原因。

### 验收

- “我想要一个魅魔角色”能够进入 collecting 并提出最少必要问题；
- 素材充分时返回 complete；
- 成人向结果明确成年；
- question/advisor 响应不会被 User 解析器处理；
- User 响应中的 `<StoryPlan>` 不会进入路线库。

## 阶段五：实现对话 / User 库双视图与路线式布局

### 任务

1. 调整 `renderStoryOraclePage()`：
   - `user-generation` 模式标签为“对话 / User 库”；
   - 其他模式保持现有“对话 / 路线”契约；
   - User 库计数不使用启用路线计数格式。
2. 新建 User 卡片渲染函数，复用路线工作台的结构配方和 CSS 语义：
   - 标题完整换行；
   - 摘要作为主信息；
   - 正文可展开；
   - 复制按钮在折叠态可用；
   - 菜单提供继续修改和删除；
   - 不出现启用、停止引导、推进速度、注入编辑。
3. 生成待保存结果在对话视图中提供明确“保存到库”和“复制”操作；保存成功后结果进入全局库。
4. “继续修改”行为：
   - 记录当前修订 item ID 或冻结的只读快照；
   - 切回 User 对话；
   - 向用户显示正在修改的角色名；
   - 只有用户后续提交才调用模型；
   - 返回 revision 时新增新 item，不覆盖旧 item。
5. 删除必须二次确认，并且只删除指定 User item。
6. 分别维护路线列表与 User 库列表的滚动位置；重绘不跳回顶部。
7. 忙碌态、只读态和保存态分别禁用正确控件，不能一刀切导致复制不可用。

### UI 约束

- 只在 `.pm-story-oracle-*` 组件族内改动；
- 使用现有语义 token；
- 无新增裸视觉值或未登记 `!important`；
- 覆盖亮色、暗色、320px、focus-visible、disabled、loading；
- 展开按钮维护 `aria-expanded`，菜单维持 menu 语义，异步按钮暴露忙碌状态。

### 验收

- User 库视觉语言与路线工作台一致，但语义和操作明确不同；
- 跨角色聊天打开 User 库看到相同 items；
- 当前聊天的 User 访谈消息不出现在其他聊天；
- 普通剧情助手视图无视觉或行为回归。

## 阶段六：实现复制能力

### 任务

1. 提供单一复制 helper，输入只能是明确的 `content` 字符串。
2. 优先调用 `navigator.clipboard.writeText(content)`。
3. Clipboard API 不可用或拒绝时：
   - 创建临时 textarea；
   - 设置正文、选中；
   - 调用 `document.execCommand('copy')`；
   - 无论成功失败都清理临时 DOM 和选择状态。
4. 两条路径均失败时抛出可诊断错误，由 UI 显示“复制失败，请展开后手动选择”或等价自然语言。
5. 成功后按钮短暂显示“已复制”，定时恢复；页面销毁时清理所有复制反馈计时器。
6. 防止并发重复点击，但不能因 User 库只读而禁用复制。

### 安全与正确性

- 只复制 `item.content` 或待保存结果的 `content`；
- 不复制 title、summary、控制标签、状态、HTML 或按钮文本；
- 使用 `textContent/value`，不得通过 HTML 拼接复制正文。

### 验收

- Clipboard 成功、Clipboard 拒绝后 fallback 成功、两者均失败、空内容拒绝、页面销毁清理均有测试；
- 折叠与展开状态复制结果逐字一致。

## 阶段七：测试与机器契约

### `scripts/check-story-oracle.mjs`

至少覆盖：

- 三个 UI 模式与四个历史模式的预期白名单；
- `user-generation` 历史不回落到 question；
- collecting/complete/revision 正例；
- 未闭合、重复、缺字段、超限和混合区块负例；
- User 响应不生成 StoryPlan；
- User 库 normalize、排序、容量、去重、新增、删除；
- 修订新增版本、不覆盖旧版本；
- 当前聊天访谈隔离与全局成品共享；
- 取消和晚返回不写入。

### 存储与备份测试

- IDB/fallback/只读/损坏/写句柄/保存队列；
- 旧备份缺字段兼容；
- 新备份往返守恒；
- User 库不参与分支 scope 复制。

### `scripts/check-contracts.mjs`

至少覆盖：

- User 生成模式菜单项和标签；
- User 卡不存在路线启用、推进、注入操作；
- 复制、展开、继续修改、删除有可访问名称；
- `aria-expanded`、disabled/loading 语义；
- CSS 仅使用登记 token，无新增裸值和未登记 `!important`；
- 320px 下关键按钮和正文仍可用。

### 回归测试

- 剧情聊天正常问答；
- 剧情参谋生成、显示、启用和注入路线；
- 世界书选择、设置、清空历史和清空路线；
- 普通聊天与其他手机模块不受影响。

## 阶段八：构建、运行验证与产物核对

### 执行顺序

1. 语法/模块检查；
2. User Generation 专项测试；
3. Story Oracle 专项测试；
4. CSS/行为契约检查；
5. 构建；
6. 全量 `npm` 检查；
7. `git diff --check`；
8. 核对构建后的 `index.js` 确实包含新模式、存储键、User 库和复制分支；
9. 检查 bundle 体积未越过 `docs/BASELINE.md` 上限；
10. 检查工作树无临时 runner、日志、预览文件、敏感内容和无关锁文件变更。

命令必须按 `package.json` 的真实脚本执行，不在计划中臆造脚本名。Windows 环境优先专用工具或 `cmd`，验证命令逐条运行以保留 exit 0 证据。

### 真实宿主人工回归

- `/phone` 打开剧情助手；
- 切换 User 生成并完成一次普通角色生成；
- 完成一次明确成年人的成人向角色生成；
- 保存并跨不同角色聊天查看同一全局库；
- 复制到外部文本区域核对正文；
- 刷新后恢复；
- Clipboard 权限拒绝时验证降级；
- 浏览器控制台无新增错误。

## 阶段九：独立验收

1. 准备验收证据：目标 diff、构建和检查 exit 0、专项测试结果、备份往返结果、构建产物核对、工作树卫生。
2. 调用独立 **Acceptance Expert**，按设计与本计划逐项核验：
   - 数据归属；
   - 不注入酒馆；
   - 全局库/访谈隔离；
   - 成人内容成年人边界；
   - 解析与错误路径；
   - 复制正确性；
   - 持久化和备份；
   - UI、可访问性和回归。
3. 存在 `blocking` 或 `major` 时修复并重新走受影响测试、构建和验收；不得把 TODO 标为 completed。
4. 最多八轮仍无法收敛时停止自动修复，向助手列出剩余问题、每轮变化和无法收敛原因。

## 5. 依赖关系与并行策略

- 阶段一是所有实施的前置门禁。
- 阶段二模型可与阶段四提示词/解析的草拟并行，但最终解析结果对象必须以模型契约为准。
- 阶段三依赖阶段二；备份接入依赖阶段一确认真实消费链。
- 阶段五依赖阶段二、三、四可用，不得先用临时假数据写死 UI 后再补存储。
- 阶段六可在阶段二接口确定后并行实现，但必须在阶段五集成验证。
- 阶段七应随各阶段同步补断言，不能等代码完成后集中补测试。
- 阶段八、九严格串行，验收不能替代构建和测试。

## 6. 风险与控制

### 风险：全局库遗漏备份

控制：持久化键创建前先定位备份清单；专项测试固定旧备份兼容与新备份往返守恒。

### 风险：模式白名单不一致导致历史串入剧情聊天

控制：同一变更同步 UI modes、history modes、labels；契约测试断言 `user-generation` 不回落。

### 风险：模型自然语言漂移导致误入库

控制：结构化区块解析、数量和字段限制、格式损坏不保存；禁止关键词猜测。

### 风险：User 库复用路线对象造成注入或清理误伤

控制：独立 model/storage；User item 不具备 `enabled/intensity/customInjectionText`；负例检查禁止相关操作出现。

### 风险：成人生成边界不稳定

控制：提示词明确成年人条件；成人向测试覆盖年龄缺失、明确成年和未成年请求；不影响其他模式。

### 风险：复制在非安全上下文失败

控制：Clipboard API + 受控 fallback；双失败准确提示；复制不依赖持久化可写状态。

### 风险：保存和历史写入部分成功

控制：区分“模型回复已保存”“待保存结果可用”“User 库已保存”；状态文案只陈述实际完成步骤，禁止笼统显示成功。

### 风险：UI 沿用变成 CSS 复制

控制：复用路线组件配方和现有 token，不复制整套选择器；新增子类仅表达 User 语义差异；机器治理检查限制裸值和 `!important`。

## 7. 回滚策略

- User 库采用独立存储键，不修改 Story Oracle V1 主键与版本；功能代码回滚后原剧情聊天和路线数据仍可读取。
- 回滚不得删除 User 库键，避免成品丢失；后续重新安装新版本仍可恢复。
- 新模式历史存于可选 `modes['user-generation']`；旧代码 normalize 会忽略未知模式但不会覆盖磁盘，前提是旧版本不触发保存。发布回滚前应提醒避免在旧版本中修改 Story Oracle 数据，或实施时评估是否需要保留未知 mode 的兼容读取。
- 备份格式新增字段必须保持可选；旧版本导入新备份时的行为须在实施前通过真实解析器确认。
- CSS 仅限组件族，可按提交回退，不影响存储数据。

## 8. 最终验收清单

- [ ] User 生成模式与独立历史槽存在；
- [ ] 模糊需求触发最少必要追问；
- [ ] 有效成品通过严格协议解析；
- [ ] 全局库跨聊天共享，访谈历史按聊天隔离；
- [ ] User 库独立于路线和注入链；
- [ ] 保存、复制、展开、继续修改、删除全部可用；
- [ ] 修订不覆盖旧版本；
- [ ] 成人向合法请求可生成且角色明确成年；
- [ ] 保存、复制、解析、存储失败均准确可恢复；
- [ ] IDB/fallback/只读保护与备份往返通过；
- [ ] 亮暗主题、320px、键盘、ARIA、loading/disabled 通过；
- [ ] 剧情聊天、剧情参谋和其他模块无回归；
- [ ] 构建产物包含变更且体积合规；
- [ ] 全量门禁和独立验收无 blocking/major。

## 9. 计划自查

这份计划已覆盖数据归属、调用链、持久化、备份、状态协议、异常路径、UI、复制、成人内容边界、测试、回滚和独立验收。仍有一个实施前必须由源码确认的风险：**旧代码保存 Story Oracle store 时是否会丢弃未知的 `user-generation` 历史槽，以及备份解析器对新增全局键的真实扩展方式**。因此阶段一不能省略。跳过它直接编码，只会制造一次回滚后丢历史、备份又漏库的双重事故。
