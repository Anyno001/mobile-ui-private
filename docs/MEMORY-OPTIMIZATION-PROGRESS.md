# 内存性能优化进度

## 当前状态

- 当前阶段：四项内存性能优化与收口验证已完成；Today Trend 已知界面刷新和失败可见性缺口按助手决定暂时保留
- 已完成阶段：聊天历史、日历单 scope、Today Trend 调度快照、背景与图片资源
- 修改范围：`public/mobile-ui-private`
- 提交规则：四项优化均已创建独立中文 commit；最终项目记录单独创建中文收口 commit，禁止由 Agent push

## 阶段启动基线

- 已重新读取 `AGENTS.md`、`docs/BASELINE.md`、`docs/LIFECYCLE-RESOURCES.md`、本进度文档、背景存储/应用/裁剪源码及现有检查。
- 阶段开始时 HEAD 为 `a77d1ed`；工作树仅有上一阶段真实宿主探针形成的本进度文档更新，没有未识别的业务代码修改。
- 原实现启动时遍历 `ST_SMS_BG_LOCAL` 索引并从 IndexedDB 读取每个 marker 对应的大 data URL，导致所有会话背景常驻 `window.__pmBgLocal`。
- 原上传路径用 `FileReader.readAsDataURL` 额外生成完整输入副本；裁剪关闭仅移除 DOM/监听，没有清空 image source、归零 Canvas 或管理 object URL。

## 本阶段实现

- `src/storage-background.js` 启动时仅保留原 `ST_SMS_BG_LOCAL` 索引；marker 背景在当前会话应用时按需从原 IndexedDB key 读取，并用两项 LRU 保留当前与最近一个会话。
- 保存路径可直接识别并保留合法 marker，不再为未修改背景重读、重写大型正文；保存成功后运行态同步为索引形态并清空旧缓存。
- `src/phone-appearance.js` 为异步背景读取增加请求序号、窗口身份和最终会话校验，快速切换时迟到结果不得覆盖新会话。
- 备份导出边界通过 `materializeLocalBackgrounds` 恢复完整旧格式内容；导入、分支继承、删除与 rollback 仍使用原 key、marker 和存储 schema。
- 上传改用文件 object URL，Cropper disposer 统一清空 image source、撤销 object URL；确认裁剪后 Canvas backing store 归零。
- 桌面背景和全局背景继续保持启动期加载及原保存行为，没有借优化之名重写无关逻辑。
- `index.js` 已通过构建从源码同步生成；未改变持久化 schema、storage key 或公开入口。

## 验证与结果

- `node scripts/check-behavior.mjs`：通过；新增 100 个 marker 背景冷启动、按需读取、两项缓存淘汰和备份 materialize 检查。
- `node scripts/check-cropper.mjs`：通过；新增 object URL 撤销和 Canvas 归零检查。
- `npm run check`：全量通过；构建、语法、AI、表情、行为、互动、pending、手势、环境、裁剪、日历、预算、权限、静态契约与 Today Trend 检查均通过。
- `git diff --check`：通过，仅有 Git 的 LF/CRLF 工作区提示。
- 结构性收益：100 个 IDB 大背景冷启动后 `window.__pmBgLocal` 仅保存短 marker；常规会话切换最多常驻两份局部大背景正文，导出时才显式读取全量内容。
- 上传预览不再同时持有 FileReader data URL 与图片解码源；裁剪关闭后的 image、Canvas 和 object URL 均有明确 owner 与释放路径。
- 自动检查证明边界与资源调用次数，不虚构真实浏览器稳定 heap、进程私有内存或 P95；这些指标仍需 SillyTavern/Chromium 宿主测量。

### 真实宿主只读探针（局部结果）

- 目标聊天完成两轮 20 秒只读探针；第二轮已从 IndexedDB 读取持久化 store，并准确命中当前 `storageId` 的 Today Trend scope。固定 32 hex 会话/末消息指纹、消息与 assistant 计数、末角色、重复计算稳定性均通过；快照序列化为 185 bytes。
- 探针期间捕获的 `error`、`unhandledrejection` 与 Today Trend warning 均为 0，只证明本次只读路径的短时控制台健康。
- 第一轮在初始化前返回 `not found`；初始化并落盘后的第二轮返回 `source: IndexedDB`、`primaryFound: true`，持久化 store 与当前 scope 检查均通过，未发现读取错误或后备存储误命中。
- 在提交 `c109b37` 已进入真实宿主后，跨页面刷新探针命中同一 `storageId`：`sms_宿傩.png__咒术回战 - 2026-05-27@19h38m58s561ms`。聊天历史刷新前后均从 IndexedDB 读取成功，当前 scope 保持 8 个会话键、2 条消息，运行态与持久化计数一致，`historyMessageDelta = 0`，全局 `error` 与 `unhandledrejection` 增量均为 0。这证明该样本的 scope 身份、数量与持久化恢复稳定；消息正文和其他 scope 未污染仍需人工界面确认，不能仅由计数推断。
- 日历样本刷新前后保持同一 `storageId`、2 个 scope，日历页面均显示 1 条事件，`calendarScopeDelta = 0`，未捕获全局错误或未处理拒绝。该结果证明已有事件可跨刷新恢复；Create/Update/Delete/取消及跨 scope 隔离尚未形成完整证据链。
- Today Trend 刷新前后主存储读取成功，当前 scope、1 条 active event 和 0 条 archived event 均保持稳定，fallback 未启用；但 `lastSuccessfulAssistantCount = 0`、`lastSuccessfulRunAt = 0` 且刷新前后无变化。因此本轮只证明现有数据可恢复，不证明自动调度、生成提交、重复事件去重或主动 UI 刷新通过。
- 上述跨刷新探针分属不同页面会话，持续记录的 `error` 与 `unhandledrejection` 均为 0；它不能覆盖探针重新安装前的初始化窗口，也不能证明被业务捕获的失败具有用户可见性。
- 助手随后完成真实宿主人工验收并确认：聊天历史保存与恢复正常，日历功能无异常，背景切换与裁剪无异常。上述三项结合静态检查、定向脚本和跨刷新探针，按本轮任务范围验收通过。
- 第三轮已确认 scope 切换为 `auto` 且 `intervalFloors: 1`，但消息总数从 33 增至 35 时 assistant 总数仍为 3；scheduler 只累计新增 assistant 楼层，首次自动观察还会以当前 assistant 数建立基线而不追溯旧楼层，因此本轮没有满足自动生成条件。探针的 `pendingAssistantEstimate: 3` 不等于 scheduler 私有的实际 pending turns。
- 当前自动与手动生成均缺少可靠的界面状态刷新：scheduler 虽维护 `queued/generating/parsing/committing/completed/failed`，但没有向已打开页面发布状态变化；页面仅在自身交互触发 render 时读取状态。各模块已有“正在生成…”模板，却可能因生成期间没有重渲染而不可见，自动成功后页面内容也不会主动刷新。
- 自动生成异步入口会消费 rejection，失败只留在 scheduler 私有 `lastError`，当前页面既不主动重渲染也不展示该字段，存在自动失败静默的可观测性缺口。自动调度、编辑、删除、重生成、重复宿主事件和生成提交链仍未完成真实宿主验证。
- 助手决定本轮暂时保留 Today Trend 当前实现及上述已知缺口，不继续扩大本次性能优化范围。该决定按已知风险收口，不等同于宣称自动调度完整宿主回归通过；scheduler 继续保持闭包私有，不为探针暴露可变状态。

## 风险与回滚

- 局部背景应用为异步路径；请求身份校验、定向脚本和助手真实宿主验收均未发现迟到覆盖或裁剪回归。
- 备份导出仍必须物化全部背景，因此导出大型备份的瞬时内存不会被本阶段消除；这是保持既有备份格式的兼容成本，不应伪装成遗漏。
- 旧 localStorage 大 data URL 仍按原协议迁移到 IDB；迁移失败时保留原值可用，不强制破坏性转换。
- Today Trend 自动生成 UI 刷新与失败可见性缺口未修复，助手已明确接受本轮暂时保留；后续若继续处理，应作为独立功能可靠性任务重新设计和验收。
- 真实 Chromium heap、操作峰值和 P95 未取得可复现数字；本轮只声明结构性常驻/副本边界改善，不虚构进程级收益。
- 独立回滚提交：聊天历史 `d29134e`、日历 `8ddac3f`、Today Trend `a77d1ed`、背景与裁剪 `c109b37`。四项均未改变持久化 schema，不需要迁移工具。

## 最终结论

- 本计划要求的四个性能热点均已有实际代码修改、定向检查、全量静态检查和独立中文提交；没有用测量脚本或文档冒充优化。
- 聊天历史、日历、背景与裁剪已由助手确认真实宿主无异常；跨刷新探针未捕获新增全局 `error` 或 `unhandledrejection`。
- Today Trend 固定长度调度快照和 observation 容量治理已完成静态与持久化验证；自动生成 UI 刷新和失败可见性作为已接受遗留风险保留，不阻塞本轮性能优化任务关闭。
- 性能优化任务判定为完成。后续若处理 Today Trend 可观测性或补充真实 heap/P95，应建立新的独立任务，不回写为本轮未完成。
