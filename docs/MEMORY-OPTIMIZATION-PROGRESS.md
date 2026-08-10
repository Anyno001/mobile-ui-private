# 内存性能优化进度

## 当前状态

- 当前阶段：背景与图片资源优化已完成静态交付，等待真实宿主定向回归
- 已完成阶段：聊天历史、日历单 scope、Today Trend 调度快照、背景与图片资源
- 修改范围：`public/mobile-ui-private`
- 提交规则：各阶段创建独立中文 commit，禁止由 Agent push；最终真实宿主回归统一收口

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
- 第三轮已确认 scope 切换为 `auto` 且 `intervalFloors: 1`，但消息总数从 33 增至 35 时 assistant 总数仍为 3；scheduler 只累计新增 assistant 楼层，首次自动观察还会以当前 assistant 数建立基线而不追溯旧楼层，因此本轮没有满足自动生成条件。探针的 `pendingAssistantEstimate: 3` 不等于 scheduler 私有的实际 pending turns。
- 当前自动与手动生成均缺少可靠的界面状态刷新：scheduler 虽维护 `queued/generating/parsing/committing/completed/failed`，但没有向已打开页面发布状态变化；页面仅在自身交互触发 render 时读取状态。各模块已有“正在生成…”模板，却可能因生成期间没有重渲染而不可见，自动成功后页面内容也不会主动刷新。
- 自动生成异步入口会消费 rejection，失败只留在 scheduler 私有 `lastError`，当前页面既不主动重渲染也不展示该字段，存在自动失败静默的可观测性缺口。自动调度、编辑、删除、重生成、重复宿主事件和生成提交链仍未完成真实宿主验证。
- scheduler 状态保持闭包私有，当前 `window.__pmDiag` 未暴露该状态。这不是产品失败条件；不得为了探针直接暴露可变 scheduler、Map 或 store。后续优先在已初始化 scope 上按真实宿主行为验收。

## 风险与回滚

- 局部背景应用现在是异步路径；已用请求身份校验阻止迟到覆盖，但真实宿主仍须验证连续快速切换、关闭窗口后迟到读取和 IDB 临时失败。
- 备份导出仍必须物化全部背景，因此导出大型备份的瞬时内存不会被本阶段消除；这是保持既有备份格式的兼容成本，不应伪装成遗漏。
- 旧 localStorage 大 data URL 仍按原协议迁移到 IDB；迁移失败时保留原值可用，不强制破坏性转换。
- Today Trend 自动生成 UI 刷新与失败可见性缺口仍未修复，最终宿主回归不得漏掉。
- 回滚：整体回退背景阶段提交；未改 schema、key 或数据内容，不需要迁移工具。

## 下一阶段启动注意事项

- 创建背景阶段中文 commit 后进入最终定向回归；禁止 push。
- 真实宿主需使用已有大量背景的数据验证冷启动、首次进入背景会话、连续快速切换、上传/取消/确认裁剪、导入导出、删除联系人/群聊及分支继承。
- Today Trend 回归必须新增 assistant 回复触发自动更新，并验证生成提交、页面刷新和失败可见性；当前已知 UI 缺口必须如实记录，不得用静态检查冒充通过。
- 收口前比较真实宿主内存和控制台结果；无法获取的指标明确标为未测，不填造数字。
