# 今日风向：历史批错误改进与只读诊断

## fix-batch-factions-world-bootstrap：本轮实施契约（覆盖下方旧方案）

助手，sliceId=factions-protocol-and-world，implementationId=fix-1，basedOnReportId=null（未提供）。基线 HEAD=64c2f804；已读取缓存上游016340d2的完整模块替换/保留未变化内容语义。以下为本轮实现，独立验收由主会话续接；下方 refine-1/docs-1 的状态、行号和投影选项是历史记录，不是现行协议。

修改面与实施决定：仅 batch adapter、generation envelope、专项测试及构建产物；不改模型600、持久化、scheduler事务或用户数据。完整factions从scheduler本批canonical的实际scope读取，不从已裁promptScope恢复；无需新公共参数。world/reputation仍upserts，dynamics/history及新阶段240/旧241–600兼容不变。

- 新模型协议：factions=null表示不变，完整数组表示模块替换；必须保留旧ID及未变化内容。缺旧ID整批拒绝，不自动合并冒充完整替换。完整父子示例见实际envelope：root parentId=null，child精确引用parent的id，details为label/value数组，relation.status使用neutral等合法枚举。
- 旧传输兼容：仅解析保留factions:{upserts:[]}；空upserts保持原集合，非空按原ID合并完整对象，并对合并后的完整集合严格校验。不是把非空旧输出变null；未知父/外部引用拒绝，不猜父、不补建、不默认置null。新提示只教授null/完整数组。DTO不持久化，无schema迁移。controller既有null合并路径无需修改。
- 完整输入：历史批单独current_factions资料块只发送一次实际scope.factions，保留全部details。current_today_trend剔除factions；普通路径仍用既有投影/预算。故v2投影即使shift掉节点，也不会影响批完整factions来源。不增加静态库或额外ID清单，不回写精简资料。
- 有界策略（major复验修订）：批current_today_trend剔除factions后的原始JSON.stringify(other).length最多12000，current_factions原始JSON.stringify(scope.factions).length独立最多240000，单位均为JavaScript UTF-16码元而非token。先按原文准入，再完整二次JSON.stringify并转义<>&，不将安全编码膨胀视作内容超额。编码文本上界为6N+2（不含外层标签），分别72002、1440002；不额外裁丢world/factions，不字符串截尾。原文超限或promptScope非法JSON明确拒绝。普通路径未改；模型上下文仍可能不足，硬校验仍是提交门禁。
- world初建：保留fullRebuild先清空语义，禁止带回含未来事实的初始化world。批提示补world_items_schema及“空模块从本批历史事实建立初始world”，选宏观区域/社会/经济/秩序态势，不将事件逐条复制，不强制填24项；非空id/name/summary示例仅说明结构。空输入+空增量仍合法，不自动造数据或一律报错；本轮不加新UI/日志警示。
- 修复不会自动恢复存量空库：只能由未来批依据事实建立，或另行授权从历史重建；本轮未重跑任何用户数据。

测试范围：真实envelope普通/批×includeExistingChat矩阵；超原12000末尾父节点/details与双层JSON完整性、超cap/非法JSON拒绝；null、完整数组、旧ID保护、父子乱序、未知父、details错形、旧upserts兼容；实际reset→离线mock controller→canonical→UI从空建立world，空增量保留已有world。mock只证明程序链，不证明真AI必然输出。新增测试防止部分势力替换丢数据与world初建回归；既有事件测试未覆盖这两类故障；仅在批传输/完整替换功能移除时考虑删除对应fixture。

其他slice仍待实施：incident历史权限、归档outcome类型表、多错汇总与最多一次纠错重试；本轮没有悄悄实现它们。下方控制台脚本原样保留。验证退出码和残留项见本轮结构化报告，未将历史验证冒充本轮通过。
本轮已运行：Windows npm.cmd分别执行build、check:today-trend、check:behavior、check:contracts、check:syntax，最终均退出0；git -C public/mobile-ui-private diff --check退出0（仅LF/CRLF提示）。专项首次因新增fixture顶层replacement重名退出1，改为局部块隔离后退出0；未跳过断言。bundle为1537875 bytes，较本轮基线1532114增加5761 bytes，来源为完整势力校验与提示构造。未运行全量check、真实AI或宿主验收。

### major预算回归复验（fix-1续轮，失败暂停）

- 上段为上一实现历史验证，不是此次通过记录。本次npm.cmd run build退出0；随后单独npm.cmd run check:today-trend退出1。执行工具仅返回“Command exited with code 1”，未返回失败断言或堆栈，不能据此断言具体根因。按请求失败暂停，未重试、未跳过断言；check:behavior/check:contracts/check:syntax及git diff --check本次尚未执行，构建contracts匹配尚未确认。
- src/prompts/today-trend/envelopes.js:17–31将完整块预算移至安全编码之前；普通block未改。scripts/check-today-trend.mjs:4806–4852新增真实canonical→serializer→envelope双层解码等值fixture：20项w0..w19、name=态势、summary=汉重复555，期望11941/11927/12185；另含引号、反斜杠、<>&，other原文12000通过/12001拒绝、势力原文240000通过/240001拒绝。以上为新增断言内容，专项整体失败，不能声称这些断言已运行通过。
- 已读窄证据：src/today-trend-v2-model.js:453–458的scopeFacadeFields直接赋值factions:scope.factions，未选择/裁剪字段；461–482的createScopePayload与485–493的projectScopePayloadToV1使用该facade。此次新增buildReadOnlyShadow完整势力deepEqual断言，但完整scheduler调用链仍待复验。
- 已定位既有专项：4777未知父引用、4778–4780非法details、4781自指、4785旧upserts未知父；不能将自指用例冒充多节点父循环/非法外部关系覆盖。取消相关744–746（用户取消与AbortError状态）、777（销毁取消）已定位；本次无逐断言执行证据，CAS覆盖尚待定位。未运行真实宿主或AI。
- 保留上一实现、其他slice及下方脚本/计划历史；未提交、推送或操作索引。剩余：先取得专项失败诊断，再处理同任务失败、执行全部独立验证并补齐上游600/UI/持久化schema diff与调用链、关系/CAS窄证据。当前不可交验为通过。

### major预算恢复结果（同taskId / factions-protocol-and-world / fix-1）

- 助手，本节为失败暂停后的实际恢复记录；上方失败过程与下方历史脚本原样保留。直接在内层cwd用PowerShell `& 'C:\Program Files\nodejs\node.exe' scripts/check-today-trend.mjs 2>&1` 取得exit=1与堆栈：4815调用serializer时由v2-model.js:970拒绝 `TT_V2_SCHEMA_INVALID: fixed core baseline 存在孤儿记录`。新增fixture克隆migratedValidV2后清空dynamics.archived，却保留其fixedCoreBaselineByEvent；不是预算实现失败，不修改生产schema校验。
- 修复仅在该隔离fixture清空对应fixedCoreBaselineByEvent。下一次专项exit=1定位到长度断言11952 !== 11941：旧预期数字不符合实际20项w0..w19的JSON结构。独立构造同结构经Node stdin核算exit=0，projection/raw/二次JSON长度为11952/11938/12194；修正三个精确断言，不删除或改成宽泛断言。一次Node -e诊断因PowerShell剥除引号产生SyntaxError、exit=1，改用here-string stdin成功，未把启动失败当通过。
- 修复后按顺序执行：build（直接Node运行node_modules/esbuild/bin/esbuild，参数与package.json build逐项相同）exit=0；check:today-trend（直接Node运行scripts/check-today-trend.mjs）exit=0，输出Today trend contracts verified；check:behavior exit=0；check:contracts exit=0；check:syntax（node --check index.js）exit=0；git -C . diff --check exit=0。后三项直接运行对应package脚本入口，均为独立进程并打印其LASTEXITCODE，不以PowerShell包装器exit代替子进程exit。专项IDB unavailable和terminal journal警告仍输出，未屏蔽错误路径。bundle实测1537880 bytes。未运行全量check或真实宿主/AI。
- 预算验收已实际通过：真实canonical→serializer→envelope，双层JSON等值、特殊字符安全编码；other原文12000接受/12001拒绝，factions原文240000接受/240001拒绝；未再次对编码结果施加12000。正常块仍沿用原行为。测试fixture修正没有改动有效边界、断言数量或生产数据。
- 完整势力窄链：v2-model.js:453–458直接取scope.factions，485–493投影沿用facade；scheduler.js:452–467从本批canonical经buildReadOnlyShadow取得batchScope并作为scope传controller，promptScope单独传递；generation.js:319–321将input.scope原样传buildGeneration；envelopes.js:24–31从scope.factions编码current_factions，不从已裁promptScope取回。专项4843–4846断言完整facade等值。
- 既有覆盖补证：专项1393确认第二节点parentId=red，1403将第一节点parentId设station形成双节点循环并要求TT_FACTION_CYCLE；1415自关联、1416未知外部关联；2132–2133断言并发CAS冲突的全部writes原子丢弃；3865取消后迟到结果拒绝；3925–3926并发CRUD保留新数据。这些随专项整体通过，不将自指冒充多节点循环。
- 范围核验：git -C public/mobile-ui-private diff --exit-code HEAD -- src/today-trend-model.js src/today-trend-v2-model.js exit=0。先用git ls-files实际定位，再对src/styles中匹配storage/history/journal/authority/commit/scheduler/view/ui/controller及全部styles的保护文件执行同一HEAD diff，exit=0；覆盖today-trend-storage、history-reducer、v2-authority、commit、scheduler、各view与UI及styles/today-trend.css。生产batch adapter diff只增势力适配并替换factions赋值；stagesFor新阶段240及历史链不改，上游模型600不改。
- 工作树已知修改仍限index.js、scripts/check-today-trend.mjs、src/prompts/today-trend/envelopes.js、src/today-trend-batch-delta.js与本记录；本续轮只修专项fixture并更新本记录，build重生成产物。既有未跟踪docs/UPSTREAM-MERGE-STATUS.md未触碰。HEAD仍64c2f8046dfd9e385d2655bbe27f7605665a242e，cached diff exit=0；无commit/push、索引操作、用户数据操作或其他slice实现。提交独立验收，不代表主会话最终完成。




## refine-1 / docs-1 历史方案与证据（保留原记录）


助手，本文件记录已确认、待实施的方案，不代表业务修复已上线。

- taskId: refine-batch-error-improvement-design
- sliceId: docs-and-explanation；implementationId: refine-1
- basedOnReportId：任务包未提供；沿用既有 docs-1 文档，不推定报告 ID。
- 源码基线：内层仓库 `64c2f8046dfd9e385d2655bbe27f7605665a242e`。
- 本轮仅精确更新既有方案文档，保留原控制台代码；不改业务、索引、持久化格式、用户数据，不生成、不自动重试、不 build/commit/push。业务状态：待实施。

## 已确认方案与待确认边界

1. 历史事实 incident 补录与主动随机生成必须分开。历史补录依据原批已发生事实，不靠概率，不得虚构；普通主动生成继续受启用与概率控制。
2. 关闭 incident 开关是否也禁止历史事实记录，尚未最终确认。推荐区分“历史记录权限”和“主动生成权限”；不得将此推荐表述成已批准绕过开关。模式修复与纠错重试分别实施、分别验收。
3. 补齐完整势力示例，`details` 数组不可省略；`upserts` 每项是完整对象替换，不是局部 patch。助手此前拒绝新增势力 ID 清单；本次解释当前快照动态投影的实现方法，不擅自采纳额外清单。超预算保留骨架仅是待确认投影策略，见下文。
4. 错误须定位批次、对象索引/匿名 ID、字段路径、预期类型与实际类型，例如 `factions.upserts[0].details: expected array, actual missing`。不得只显示“势力资料无效”，也不得默认带出正文。
5. 自动纠正就是第二次 AI 请求，最多自动重试 1 次（原请求与纠正合计 2 次），最多产生一次额外调用费用。只对白名单格式错误重试；锁定原批事实、权限抽签结果和提交基准，不重抽签、不重复提交、不重跑已成功批。第二次仍失败即停止并报告。

### 分类与重试白名单

- 可纠正：JSON 语法、字段集合、必需字段缺失、对象/数组/标量类型错误。仅在未提交且能保持事实与权限基准时允许一次纠正。
- 不盲重试：取消、网络/HTTP、存储失败、事务恢复、CAS/版本冲突、权限/配置错误、未知错误。输出截断与 token 限制先诊断，不当作必然可纠正。
- 历史 incident 被随机权限拒绝是模式契约问题，不得让 AI 改类型、删事实或靠再次抽签“纠正”。
- 不修改 schema/version 或扩大兼容拒绝；后续若触及磁盘格式须另行盘点历史格式及迁移、恢复路径。

### 多错反馈与纠正提交（已认可，待实施）

只汇总能独立安全检查的字段和关系；例如一个势力缺 details 不应阻止另一个独立事件的 outcome 检查。若对象形状、ID 唯一性或引用目标解析失败，依赖这些前提的关系检查标记 `unchecked`，不能伪报通过或堆叠衍生错误。当前 `today-trend-batch-delta.js:3–17,31–38` 仍遇错即抛出，不具备此多错能力。

建议错误结构：`errors:[{object:"faction-1",path:"factions.upserts[0].details",actual:"missing",expected:"array<{label:string,value:string}>"}]`。object 使用索引/匿名 ID，actual 仅类型、缺失标记或必要的安全枚举，expected 仅最小契约；关系错误仅带定位所需占位 ID，不输出整个对象、details 正文或剧情。UI 还须提供批次定位，未检查项单列。

最多 1 次额外 AI 格式纠正，总请求最多 2 次，尽量一次反馈多错而不是逐字段请求。纠正仍锁定原批快照/事实/权限和提交基准，不扩大模块权限，不重新抽签；纠正结果须重新经过完整校验与 CAS 检查，然后一次提交。网络、取消、存储、版本冲突不纳入格式纠正；第二次失败停止，报告仍失败与未检查项，不部分落盘。

### 失败结构证据边界

助手已提供 #1/#5/#8 原 JSON 和 HTTP 200 记录；本轮依据任务包明确的匿名事实修正文档，不重复索要这些样本，也不把收到样本写成已在本地复现。HTTP 200 只证明请求获得 HTTP 成功响应，不代表批次通过业务校验或提交成功。

- **#1：权限协议冲突确证。** 输入权限提示禁止 incident，响应却 create 新 incident。源聊天未见，不能据此判定事件虚构，也不能将当前表单设置当作失败时配置。
- **#5：父引用失败，非 details 类型错误。** 唯一势力 upsert 是 `child-id`，`parentId=parent-id`，`details` 为合法数组，同批未创建父势力；实际报错为父势力不存在，校验候选全集合缺少该父 ID。尚不能区分模型编造 ID、实际父势力使用其他 ID、或输入投影缺失；投影裁剪的源码风险不是本次裁剪已经发生的证据。上方 `faction-1` 缺 details 仍仅为契约示例，不是 #5 的实际缺失项。
- **#8：归档类型冲突与权限冲突并存。** 输入禁止 incident，响应却 create 新 incident 和 normal；唯一 archive 为 `existing-event-id`，`outcome=confirmed`，实际报错为事件类型与完结结果不匹配。`confirmed` 只适用于 rumor；未提供旧事件具体 type，不能把归档目标判为 normal，更不能用同批 create 的 type 代替旧 type。类型校验早于权限校验，可遮蔽已存在的 incident 权限错误，不能因只显示归档报错就判定权限通过。
- **#8：新建事件封日候选不适用。** 两个新建事件均附 `daySummaries`；其中 `keyStages` 使用 `eventID` 符合当前协议，不能误报为必须使用 `stageID`。新建事件没有旧开放日期，本不应给封日摘要；但 reducer 会忽略格式合格却不适用的候选，不必然报错，不能将其等同于已观察到的归档失败根因。

尚缺的是失败前 canonical、归档目标的具体旧 type，以及实际发送给模型的完整输入（包括投影）；不是已收到的三批输出。现有权限提示足以确认 #1/#8 的输出违约，但不足以重建全部运行时配置、抽签与输入。上述缺项限制根因细分和后续复现，不阻塞本轮证据修正文档；不复制敏感剧情或名称正文。

### 完整势力传输示例（虚构测试数据，不是用户事实）

```json
{"factions":{"upserts":[{"id":"example-faction","name":"示例组织","summary":"仅用于结构测试","parentId":null,"relatedFactionIds":[],"details":[{"label":"职责","value":"示例职责"}],"relation":{"status":"中立","evaluation":"暂无交互"}}]}}
```

这是完整势力对象的局部展示，不是完整批响应。完整批根字段是 `world/reputation/factions/dynamics/history`；前三者包含 `upserts`，dynamics 包含 `create/appendStages/archive`，history 包含 `events`。`details: []` 仍须显式存在；不要自动补造资料。

## 本轮核实：父势力资料如何发送

- 每个历史批从当前聊天 canonical 快照生成投影，不是固定 ID 库，也不是单独请求父势力：`src/today-trend.js:64–67` 注入读取器；`src/today-trend-scheduler.js:459–467` 以本批 canonical 调用并传入 `promptScope`；`src/today-trend-generation.js:319–320` 交给 envelope。
- `src/today-trend-v2-model.js:323–334` 按 `storageId` 取 `globalEnvelope.payload.scopes[storageId].payload`，起始是整个 `payload.factions` 的深拷贝，不按子节点选择父节点。势力字段为 `id/name/summary/parentId/relatedFactionIds/details/relation`，其中 `details` 是 `label/value` 数组（`src/prompts/today-trend/envelopes.js:85`）。事件历史详情被投影排除，不等于势力 `details` 被排除。
- 默认预算是整个投影 12000 个 JavaScript UTF-16 码元，不是每个父势力 12000，也不是 token 数。`v2-model.js:296–316` 先减事件阶段/摘要，再删 archived、部分 active；仍超预算就 `factions.shift()` 整项删除。未超预算可发送全部当前势力资料；超预算不能保证所有父节点可见，删除也没有父链闭包保护，通常返回结果不附截断标记（仅最终空投影 fallback 有 `truncated:true`）。本地节点并未因此被删除。
- 二次预算：`envelopes.js:76` 将投影作为 `current_today_trend`，`10–14` 先 `trim().slice(0,12000)`，再 JSON.stringify 为外层 JSON 字符串。正常默认 canonical 投影已在同一上限内，二次 slice 不会再切掉其对象尾部；但更大自定义投影或无投影时的 scope fallback 可被截成不完整的内层 JSON、隐藏尾部节点。外层 JSON 字符串/标签仍合法，不代表其中的对象完整。转义后整体提示长度也不受该 12000 上限保证。
- `src/today-trend-batch-delta.js:19–27,92–95` 按 ID 合并，但同 ID 的 `result[index] = item` 是整项替换。仅引用父 ID 时不必在输出重发父资料；改旧势力时必须能保留完整旧字段，包括原 `details`。精简输入不是完整旧对象，不能让模型把截断 details 或随手补的 `[]` 写回覆盖原资料。

### 给助手的结论与待确认选项

不必每次额外发送一份“全部父势力资料”：预算足够时现有 factions 已包含它们，只需正确使用精确 ID。预算不足时，单写“用已有 ID”不会让 AI 知道没收到的 ID。

可选方案是优先裁剪描述而非静默丢节点，或在现有 `factions` 表示中保留当前聊天动态生成的完整 `id/name/parentId` 骨架；这不是维护跨聊天固定 ID 库，也不是已获授权新增清单。两者都是待确认的投影策略，须保护父链和关联校验，按结构预算而非字符串截尾；骨架仍超预算须可诊断地停止，不能承诺永不超限。对待更新对象若无法提供完整旧字段，应阻止不安全替换并报告输入不足；不能把精简对象当完整旧对象。不得自动将未知 parentId 改 null 或补建虚构父势力。

## 简洁提示词建议（仅方案，未写入业务提示词）

> 历史批只回填本批已有事实，不抽 incident 生成概率，不虚构新事故；历史记录权限与主动生成权限分开，遵守已确认权限，incident 关闭时的历史记录规则尚待确认。
> parentId 使用本轮输入可核实的既有精确 ID，或本批有事实依据的新势力 ID；不猜测、不自动置空或补建父节点。upserts 只输出变化项的完整字段，details 必须是数组；精简输入不是完整旧对象，资料不足不得重发覆盖。
> 按既有 type 选择归档 outcome：normal/incident → resolved|failed|terminated|inconclusive；rumor → confirmed|debunked；underground → resolved|failed|terminated|inconclusive|absorbed。不得改 type 迁就 outcome；absorbed 必须由 active incident 的 relatedEventIds 关联承接地下线。
> 本批 create 没有旧日开放阶段，daySummaries=[]；已有事件仅当本地可信 story_date 严格晚于其唯一开放 live-stage 日期时提供恰好一项封日摘要，否则 []。不得推断日期或用摘要替代阶段。

该 type/outcome 表对应 `src/today-trend-model.js:131–132`；active incident 承接条件对应 `src/today-trend-v2-model.js:1482–1483`。现有历史 envelope `85–89` 只给平铺 outcome 枚举，且没有显式点明 create 无旧日阶段，建议补明而不是放宽校验。历史 incident 分权已认可，但关闭开关含义仍待确认，不能仅改提示词后让现有随机权限继续拒绝。

## 运行时事实与隐私限制

- 实际开关位置是当前聊天 `scope.dynamicsSettings.incident.enabled/probability`，不是 `preset.incident`。预设绑定由 `scope.presetId` 关联。当前概率不是失败时概率，更不是当批实际 `allowIncident`。
- `src/today-trend-generation.js:319–358`：raw 是局部变量；只在成功返回对象中带 raw，失败包装 cause，但不附 rawText。
- `src/ai.js:78–93`：解析器吞掉候选 JSON.parse 错误后给出通用错误，不保留原始文本/语法位置。`237–324`：独立 API 返回提取后的 content；隔离宿主路径调用 context.generateRaw 后直接返回，无本插件响应日志保存。
- `src/today-trend-scheduler.js:250–264,623`：公开状态保存 lastError 文本，不公开 raw 或抽签结果。插件公开状态没有已核实的失败 raw 恢复入口；这不否定助手已经提供的 #1/#5/#8 原 JSON。对于未另行保存的其他失败响应，若宿主/服务商当时也未保留，事后不能恢复。
- 宿主 generateRaw 的内部日志实现不在既有核实范围中；不能承诺存在某个宿主日志 getter 或路径。#1/#5/#8 无须重新获取或提交样本；后续其他失败如需结构诊断，仅使用已保存的单批 JSON 或宿主/服务商已有响应记录，不需要全聊天、请求头、密钥、整库导出。不新增日志功能、不拦截 fetch、不 patch 函数。

## 控制台 A：只读当前设置表单

未核实到可直接读取当前 committed 设置的 window getter/dump。`__pmTodayTrend` 只见于备份恢复/分支继承写入，不应当成实时权威快照。`__pmDiag` 需安装前显式开启（diagnostic.js:86–88,136）；本轮不启用。其 todayTrend.status 调用 loadStore，后者经过 ensureReady/事务恢复，不能冒充严格无副作用读取（today-trend.js:27–46,344–348）。

优先读取已经显示的“事件追踪设置”表单；如果没有显示则返回 unavailable，不自行打开 UI。由助手在正常界面打开后，未编辑时可再执行；若已有未保存编辑，读取的是草稿而非已提交设置。代码不调用任何业务函数，也不证明表单仍对应当前聊天。不要为诊断点击保存或重新生成。

调用证据：today-trend-dynamics-view.js:23–25,82–85 从 scope.dynamicsSettings 渲染该 form 与两个 input；today-trend-ui.js:85–87 渲染 checkbox。仅标准 DOM querySelectorAll/querySelector/getAttribute，无全聊天/全库遍历。

```js
(() => {
  const forms = document.querySelectorAll('form[data-today-trend-form="dynamics-settings"]');
  let report = { status: 'unavailable', source: 'rendered-form-not-committed-snapshot',
    enabled: null, probability: null, allowIncidentAtFailure: 'unknown' };
  if (forms.length === 1) {
    const e = forms[0].querySelector('input[name="incidentEnabled"]');
    const p = forms[0].querySelector('input[name="incidentProbability"]');
    const text = p?.value?.trim();
    const n = text ? Number(text) : NaN;
    if (e?.type === 'checkbox' && Number.isInteger(n) && n >=0 && n <= 100) {
      report = { ...report, status: 'ok', enabled: e.checked, probability: n,
        editedSinceRender: e.checked !== e.defaultChecked || p.value !== p.defaultValue };
    }
  }
  console.log(JSON.stringify(report, null, 2));
})();
```

概率调用证据：today-trend-scheduler.js:353–358 抽签，464–465 历史批当场抽签，545–554 普通生成使用当前 scope 或调用参数覆盖。当前表单或概率不能反推失败时配置或实际 allowIncident；#1/#8 已提供的权限提示则明确禁止 incident，足以确认响应违反该次提示，无须用当前表单重新证明。

## 控制台 B：本地单批 JSON 结构脱敏

这不是原始响应恢复器，也不是要求重新提交 #1/#5/#8。保留为后续可选的本地结构脱敏工具：对已有的单批模型 JSON 文本，使用下面输入框在本地粘贴，不把原文写进控制台命令历史。取消不输出；脚本不联网、不持久化、不触发生成。只输出类型树、已知结构键、同值一致 ID 别名；未知键也匿名化，不默认输出正文、人名或 token。不输出异常 message（JSON.parse 错误可能含原文）。

```js
(() => {
  const raw = prompt('仅粘贴一批模型 JSON；不含请求头/全聊天。取消退出。');
  if (raw === null) return;
  if (raw.length > 200000) { console.log('{"status":"too-large"}'); return; }
  const known = new Set(('world reputation factions dynamics history upserts create appendStages archive events id eventId name summary parentId relatedFactionIds details label value relation status evaluation items circles scope type title stageLabel origin participants initialStage relatedEventIds stages outcome finalResult daySummaries periodSummaries text time timeLabel startDate endDate storyDate startTime endTime').split(' '));
  const ids = new Map(), keys = new Map();
  const alias = (map, value, prefix) => {
    if (!map.has(value)) map.set(value, prefix + (map.size + 1));
    return map.get(value);
  };
  let count = 0;
  const shape = (v, key = '', depth = 0) => {
    if (++count > 4000 || depth > 24) return { type: 'limited' };
    if (v === null) return { type: 'null' };
    if (Array.isArray(v)) return { type: 'array', length: v.length,
      items: v.slice(0, 80).map(x => shape(x, key, depth + 1)), truncated: v.length > 80 };
    if (typeof v === 'object') return { type: 'object', fields: Object.entries(v).slice(0, 80).map(([k, x]) => ({
      key: known.has(k) ? k : alias(keys, k, 'key-'), value: shape(x, k, depth + 1)
    })), truncated: Object.keys(v).length > 80 };
    if (typeof v === 'string' && /^(id|eventId|parentId|relatedFactionIds|relatedEventIds)$/.test(key))
      return { type: 'string', alias: alias(ids, v, 'id-') };
    return { type: typeof v };
  };
  let result;
  try { result = { status: 'parsed', shape: shape(JSON.parse(raw)) }; }
  catch (error) {
    const m = String(error?.message || '');
    const position = m.match(/position\s+(\d+)/i);
    const lc = m.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    result = { status: 'invalid-json', position: position ? Number(position[1]) : null,
      line: lc ? Number(lc[1]) : null, column: lc ? Number(lc[2]) : null };
  }
  console.log(JSON.stringify(result, null, 2));
})();
```

以上仅用标准 prompt/JSON/Map/数组 API，无运行时 getter。它严格 JSON.parse，不复刻业务解析器的去 think/代码围栏行为；语法位置相对输入原文，浏览器不提供则为 null。缺失字段可对照类型树与契约判断；不会宣称完成业务校验。非法 JSON 不尝试正则脱敏原文，只输出位置。类型、数组长度、字段布局与 ID 关联本身仍可能泄露关系；别名仅本次运行一致，截断会隐藏后续错误。发送前必须人工复核，只提交脱敏结果和最小错误路径。

## 验收标准（业务项均待实施）

- 完整势力对象与 details 空数组成功；缺失/对象/string 类型分别给出精确路径、expected/actual；upsert 不静默保留缺失旧字段。
- 有事实依据的历史 incident 不依赖概率；关闭开关的行为待确认后才固化测试。普通生成开关/0/100/中间概率与定向生成回归不放宽。
- 可纠正错误总调用数至多 2；取消/网络/存储/CAS/权限与未知错误不自动重试；第二次失败仍可诊断。
- 重试固定批次事实、权限与基准，成功批不重跑；取消/切聊/版本变化阻止迟到结果提交；最终只有一次有效提交，无重复阶段。
- 不擅自增加势力 ID 清单；投影策略变更须另行确认。不新增业务响应日志，不改变旧持久化数据的读取与恢复。
- 诊断无宿主写入/请求，空值失败闭合，不输出正文/人名/凭证；必须区分已提供的原始响应与未保存且无恢复入口的响应，以及当前设置与失败时设置，不重复索要已提供样本。

## 前轮 docs-1 验证记录（保留，不代表本轮重跑）

- 纯 Node VM 从本文抽取两个完整 js 代码块执行，mock DOM/prompt/console，不访问宿主数据：通过。
- 覆盖：表单缺失、false/0/100、草稿变化、空概率、取消、JSON null、相同 ID 一致别名、未知键脱敏、非法 JSON 位置且不泄露原文、200000 字符输入上限。
- `git -C public/mobile-ui-private diff --check` 通过（新文档未跟踪，另以静态检查确认其无行尾空白）。未运行浏览器验证、业务回归、构建；不将其写作通过。
- 状态仅新增本文档，原有 `docs/UPSTREAM-MERGE-STATUS.md` 未触碰；业务源码与 index.js 未修改。
- 契约依据补充：today-trend-batch-delta.js:19–27,31–38,92–95 定义完整对象替换与根结构；today-trend-generation.js:38–42 要求 details 数组。后续修复必须保持这些消费者契约，不能将上面的测试示例当作事实生成来源。
## S1 实施记录：历史 incident 权限分权（taskId=implement-remaining-batch-improvements / sliceId=S1-history-incident-permission / implementationId=s1-1）

- 实现入口：src/today-trend-scheduler.js、src/today-trend-generation.js、src/prompts/today-trend/envelopes.js；调用方（phone-controller/today-trend）无需改动。
- 语义（D1 已批准，按本次实施落地）：
  - 历史批权限：`allowHistoricalIncidentRecord = dynamicsSettings.incident.enabled === true`，由开关直通，不再调用 `rollIncident`。即便概率为 0 也允许按事实补录。
  - 普通更新权限：`allowIncident = rollIncident(effectiveIncidentProbability)`，沿用既有开关+概率语义；总开关关闭时 `effectiveIncidentProbability = 0`。
  - 已有 incident 事件追加阶段沿用既有规则，与开关/概率均无关。
  - 历史补录严禁虚构：提示词明确"只能根据本批 history_batch_data 明确发生的事实……不可主动推演或编造 incident。没有明确事实时不得新建 incident，包括空历史批"。
  - 开关关闭时：历史批与普通更新均返回 false，提示词改为"禁止新建 incident，包括历史事实补录"。
- generation.js：派生 `historical = Array.isArray(input.historyBatch)`；`allowIncident = !historical && enabled && input.allowIncident===true`；`allowHistoricalIncidentRecord = historical && enabled && input.allowHistoricalIncidentRecord===true`。两条派生路径独立，互不影响。
- envelopes.js：历史批 systemPrompt 末尾条件块按 enabled 切换；普通 systemPrompt 末尾条件块按 allowIncident 切换；两者互斥不混用。
- 未改动：src/today-trend-model.js（上游 600 上限）、本地新阶段 240/旧 241–600、UI、存储 schema、reset 语义；world/factions 现行修复原样保留。

### 验证退出码（Windows，cwd=public/mobile-ui-private）

| # | 命令 | EXIT |
|---|---|---|
| 1 | esbuild src/main.js --bundle --format=iife --platform=browser --target=es2020 --outfile=index.js --legal-comments=none --minify-syntax --minify-whitespace | 0 |
| 2 | node scripts/check-today-trend.mjs | 0 |
| 3 | node scripts/check-behavior.mjs | 0 |
| 4 | node scripts/check-contracts.mjs | 0 |
| 5 | node --check index.js | 0 |
| 6 | git -C public/mobile-ui-private diff --check | 0 |

bundle=1539142 bytes（build 前为 1537880，+1262 bytes，来自 generation/scheduler/envelopes 条件分支与 systemPrompt 文本）。check-today-trend 输出含预期内的 `[phone-mode] IDB unavailable` 与 `[phone-mode] Today Trend terminal journal 清理失败` 噪声（pre-existing，非新增失败路径）；终行 `Today trend contracts verified.`

### M1 权限矩阵覆盖（scripts/check-today-trend.mjs）

- 5603–5632：enabled/disabled × 已有 incident 事件追加阶段（开关不影响追加）；rumor/underground 创建在 incident 仅开时仍被拒绝；空增量保留原状；240 上限拒绝；开关关闭时拒绝 incident 创建；开关开启但 `allowHistoricalIncidentRecord:false/undefined` 也拒绝创建。
- 5634–5680：historical × enabled × probability(0/10/100) × draw(0.09/0.10/0.11) 全 16 组笛卡尔组合：
  - 系统提示断言：历史批 enabled→`/只能根据本批 history_batch_data 明确发生的事实/`；历史批 disabled→`/禁止新建 incident，包括历史事实补录/`；普通 enabled+概率通过→`/本轮允许在合理时创建 incident/`；普通拒绝→`/本轮不允许新建 type 为 incident/`；不允许任何路径出现"允许合理创建 incident"旧文案。
  - 调用计数断言：`aiCalls===1`；`randomCalls===0`（历史批任何概率）；`commits === (historical?1:0) + (permitted?1:0)`（清空事务与候选提交分开计数）。
  - 拒绝路径：`未允许生成突发事件`，且 `canonical === beforeGeneration`（无半写）。

### 既有回归保留

- world/factions（fix-1）：完整父子、双节点循环、未知父引用、自指、双层 JSON 等值、特殊字符安全编码、原文 12000/12001、factions 原文 240000/240001 等继续通过。
- 240 上限、新阶段 240/旧 241–600 只读兼容继续通过。
- HEAD 未变：64c2f8046dfd9e385d2655bbe27f7605665a242e。未 commit/push/merge/reset/checkout，未操作 Git 索引、用户数据、持久化 schema。

### 范围外

S2（type/outcome 表 + 日期反例）、S3（字段错误契约）、S4（多错汇总/unchecked）、S5（自动纠正重试）未实施；不在本轮授权内。

## S2 实施记录（s2-1）
- 改动：src/prompts/today-trend/envelopes.js 历史批systemPrompt新增type→outcome对照表与新建事件daySummaries=[]反例；scripts/check-today-trend.mjs 新增S2断言块（正向映射+子句边界反向校验）。
- 语义：normal/incident→resolved|failed|terminated|inconclusive；rumor→confirmed|debunked；underground前四+absorbed（须active incident relatedEventIds承接）；按既有type选择outcome不得改type迁就；confirmed仅传闻证实非通用完结；新建事件无旧日开放阶段daySummaries必须为[]，禁止自行推断日期。
- 验证：build/check:today-trend/check:behavior/check:contracts/node --check index.js/git diff --check 六项EXIT=0；bundle 1539994 bytes；测试正则窗口修复记录（[\s\S]{0,80}跨越全角分号误命中→[^\uFF1B]*）。
- 边界：S1权限逻辑、fix-1 factions/world、普通路径、上游600、本地240、UI/存储/reset未改；S3-S5未实施。


## S2 验收修复记录（s2-2）

- 助手，taskId=implement-remaining-batch-improvements；sliceId=S2-outcome-and-day-summary-prompt；implementationId=s2-2；basedOnReportId=null（未提供）。本节修正上方 s2-1 测试有效性记录，不将历史 EXIT=0 当成本轮证据。
- 本轮仅手工修改 scripts/check-today-trend.mjs 的 S2 断言块及本文；执行既有 build 重生成 index.js，产物仍为 1539994 bytes。未修改 envelopes.js 业务文本、公共接口、持久化格式、S1/fix-1/model/UI/存储/reset。
- 反向 pattern 从 `/rumor[^\\uFF1B]*resolved/` 改为 `/rumor[^；]*resolved/`，其他类型和 outcome 逐项使用真正的全角分号边界。原双反斜杠字符类并非 Unicode 分号排除。
- normal、incident 的四项、rumor 的两项、underground 的上述四项加 absorbed 均逐类型完整 deepEqual 并逐项 includes；保留 absorbed 的 active incident / relatedEventIds 承接与禁止改 type、confirmed 非通用完结断言。
- 对 resolved/failed/terminated/inconclusive/absorbed 分别仅变异测试字符串的 rumor 子句，先断言字符串确实改变，再用对应反向 pattern 断言命中；另断言同一非法词放在全角分号后的其他子句不会命中。不改生产 prompt。
- 新建事件规则单独提取完整句，逐项断言本批 create、没有旧日开放阶段、即使同批追加多个阶段、daySummaries 必须为 []、禁止自行推断日期。
- 六项独立验证全部 exit=0：内层 cwd 执行 npm.cmd run build（Done in 56ms）、node scripts/check-today-trend.mjs（Today trend contracts verified.）、node scripts/check-behavior.mjs（Behavior configuration verified.）、node scripts/check-contracts.mjs（Static contracts verified.）、node --check index.js（无输出）；根 cwd 执行 git -C public/mobile-ui-private diff --check（仅 LF/CRLF warnings）。专项保留 IDB unavailable / terminal journal 失败路径输出，behavior 保留故障注入输出，未屏蔽或跳过断言。未运行全量 check、真实 AI 或宿主验收。
- 计划状态：S2 s2-2 验收修复已实施且上述验证通过，待主会话独立验收；S3 pending、S4 pending、S5 pending，均未实施。没有调用计划管理工具或替主会话宣布整个任务完成。


## S3 字段级错误恢复与实施（s3-2-recover-and-complete）

- 助手，taskId=implement-remaining-batch-improvements；sliceId=S3-field-level-errors；implementationId=s3-2-recover-and-complete；basedOnReportId=null（未提供）。S3 已实施并通过本次六项指定验证，待主会话独立验收；S4 pending；S5 暂不实施。下方/前文历史范围声明不作为本轮状态。
- 恢复核实：完整读取 batch-delta，未见重复定义；HEAD=64c2f8046dfd9e385d2655bbe27f7605665a242e，cached diff exit=0。首次专项 exit=1 无输出；按任务指定强制文本诊断取得实际 Node EXIT=1：旧断言 check-today-trend.mjs:5094 绑定 create[batch-new]，实际 S3 安全路径为 create[0]，不是 IDB unavailable 警告引起。
- 最小修复：stagesFor 的 message 删除模型原始 ID，只保留索引路径和原中文校验关键词；缺失旧 ID 消息已为安全固定文案。四处原值绑定路径断言改为精确 slot [0]，保留 initialStage/stages[0]/id 字段、拒绝条件和 240 边界断言，不降低业务校验。
- 当前契约：batch adapter 首错即抛 code=TT_BATCH_VALIDATION；details 固定单元素且 element 严格 object/path/expected/actual 四键，冻结，只含固定字段、slot、类型或安全枚举。generation 原样 rethrow；scheduler 的 lastError 保留字符串，lastErrorDetails 仅接严格 code、四键、slot 和枚举白名单校验后的副本，run/rollback 失败可写入，非 failed 状态清空。不保存 error/cause/raw，不改 UI/settings/diagnostic/journal/commit 或持久化 schema，无磁盘迁移需要。
- M4 通过真实 controller.generate→materialize 覆盖 details object、缺 parentId、未知父、自指、外部/自指/父子 related、非法 ID、root/子字段集、241 字阶段；函数式 rejects 验证单元素四键及 message/details 无隐私标记且无 cause。scheduler 测试覆盖安全 details、取消清除、失败后成功直接清除、非精确 code/额外键/危险 object/path/actual/expected/多元素拒收。既有 null/完整数组/旧 upserts 与新 240/旧 241–600 回归保留。
- 顺序验证全部 exit=0：npm.cmd run build（Done in 20ms）；node scripts/check-today-trend.mjs（Today trend contracts verified.）；node scripts/check-behavior.mjs（Behavior configuration verified.）；node scripts/check-contracts.mjs（Bundle observation: 1543093 bytes；Static contracts verified.）；node --check index.js（无输出）；根 cwd git -C public/mobile-ui-private diff --check（仅 LF/CRLF warnings）。故障注入输出未屏蔽，诊断包装器 exit=0 未当作专项通过。
- 本恢复轮手工代码只改 batch-delta 和专项测试；generation/scheduler 中上轮 S3 实现已读取保留；build 重生成 index.js。既有 S1/S2/fix-1 累计工作树和 UPSTREAM-MERGE-STATUS.md 保留。未运行全量 check、真实 AI/宿主验收；未实施多错聚合、unchecked 或自动格式纠正。
- 回滚仅逆向本 S3 精确 hunk 并重新 build/验证；不得 reset/checkout 整个累计脏文件，不动用户数据，不操作索引。

## S4 多错聚合实施（s4-4，已实施，待独立验收）

- 助手，本节为当前状态，覆盖前文 S4 pending；S5 暂不实施。sliceId=S4-batch-error-aggregation；basedOnReportId=null（任务未提供）。
- batch-delta 在 materialize 入口增加请求私有预检 accumulator；真实错误与 unchecked 分别计数，按检查顺序最多保存20条冻结四键 details，不新增顶层字段。多真实错误仅固定计数摘要；单真实错误保留字段路径/中文关键词。错误在克隆 dynamics、normalize、返回前抛出，scope 只读。成功路径保留既有 materializer 与权威校验。
- 依赖：根非对象→各模块 unchecked；upserts/dynamics/history 前置字段缺失→子数组 unchecked；faction 字段集失败→details/relation/parent/related unchecked；details 非数组→details[0] 字段检查占位 unchecked（不代表真实元素）；faction ID 基础失败→旧ID集合与关系 unchecked；create 数组/字段/ID失败→无法确认的新 active append/archive/history 引用 unchecked，已知旧 active 仍可判断。同层可判断的阶段/归档配置错误独立收集。
- 消费者搜索确认 generation 原样传播 TT_BATCH_VALIDATION，scheduler 为结构详情唯一 src 消费者。safeBatchError 接受1..20条，逐项四自有键、240长度、数字slot、安全expected/actual白名单，actual只新增unchecked；逐项复制冻结，任一不安全整组null。lastError仍字符串，lastErrorDetails仅内存，无磁盘格式/迁移、UI/settings/diagnostic/journal/commit改动。
- M4保留独立单错deepEqual，依赖失败增加精确unchecked数组；安全2/20项接受并复制冻结，空/21项及恶意code/第五键/slot/枚举拒绝。M5真实controller→materialize覆盖details object + 超240阶段 + unknown active三真实错误及1 unchecked，完整数组/固定摘要/敏感marker不进入message/details/state，commit=0，scope/store不变；另测create=null的三个依赖引用unchecked；取消/acknowledge/后续成功清除多元素状态。
- 六项顺序验证均exit=0：npm.cmd run build（Done in 20ms）；node scripts/check-today-trend.mjs（Today trend contracts verified.）；node scripts/check-behavior.mjs（Behavior configuration verified.）；node scripts/check-contracts.mjs（1550865 bytes；Static contracts verified.）；node --check index.js（无输出）；根cwd git -C public/mobile-ui-private diff --check（仅LF/CRLF warnings）。测试故障注入警告原样保留。
- 风险/待验收：预检与原权威校验并存，后续规则变更须同步维护；超过20条仅保留前20条而摘要计数仍为全部；当前测试未对normalize注入spy，靠入口throw的控制流证明；真实AI/宿主及全量check未运行。S4不增加outcome校验，不实现retry/correction/第二次AI。
- 回滚仅逆向本轮三个源码/测试文件新增hunk、文档追加，再build并重跑六项；不得回退整个累计脏文件。既有S1/S2/S3和未跟踪UPSTREAM文档保留，不操作索引或用户数据。


## S6 世界态势容量修复（world-cap-1）

- 助手，taskId=world-cap-prompt-and-guard；sliceId=world-cap-guard；implementationId=world-cap-1；basedOnReportId=null（未提供）。起始 HEAD=26a71675600b929a7c8a4ac3f27643ab05abe1ea，索引为空，仅未跟踪 UPSTREAM-MERGE-STATUS.md；该文档未触碰。
- envelopes.js:105–106 仅历史批新增长期宏观索引、非逐批日志、禁止逐条复制/凑数、未满22时新ID须无法由已有条目覆盖且长期跨事件；动态当前N/24及最多24个已有ID的JSON.stringify清单。N>=22禁止任何新ID，只更新已有ID或空upserts；24项仍可更新已有ID。
- batch-delta.js:40–53 私有guard：existing=previous.length，newUnique为string ID中不在existingIds的唯一集合大小；existing>=22且newUnique>0拒绝，否则existing+newUnique>24拒绝。246–247在validateBatch成功后立即执行，早于world物化。独立TT_WORLD_CAPACITY仅固定中文和计数，不创建details/cause/raw，不带原ID/名称/正文。generation.js:363原样透传。
- check-today-trend.mjs:4671–4723新增12组真实materialize：22空/旧ID更新通过，22新增1/3拒绝；23及24旧ID更新通过/新增1拒绝；21新增1/3及旧ID更新通过/新增4拒绝。成功和拒绝scope均不变；错误code、计数、中文恢复指引、隐私字段缺失均断言。另4组N=21/22/23/24历史prompt、1组generation透传通过。
- 顺序验证全部exit=0：node --check src/today-trend-batch-delta.js、node --check src/prompts/today-trend/envelopes.js（均无输出）；npm.cmd run build（Done in 20ms）；node scripts/check-today-trend.mjs（S6矩阵通过，Today trend contracts verified.）；node scripts/check-behavior.mjs（Behavior configuration verified.）；node scripts/check-contracts.mjs（1552826 bytes，Static contracts verified.）；node --check index.js（无输出）；根cwd git -C public/mobile-ui-private diff --check（仅LF/CRLF warnings）。测试故障注入日志未屏蔽。
- S4 validateBatch/TT_BATCH_VALIDATION聚合及M4/M5断言未改，S1–S4既有行为保留；S5 retry/correction未实施；UI/schema/model text=600/阶段240/用户数据未改。公共签名与磁盘格式不变，无迁移；普通生成不受新增guard约束。
- 风险：模型仍可能违反宏观语义，离线测试不证明真实AI事实判断；未运行真实宿主/AI或全量check。仅授权内层六文件进入中文提交“限制今日风向世界态势新增容量”；根三份计划追加不进内层索引。提交结果以实施报告为准。
- 回滚方案（未执行）：仅逆向本修复源码/测试和追加文档，再build重生index.js并重跑验证；保留既有提交、UPSTREAM文档及用户数据，禁止reset/checkout。
