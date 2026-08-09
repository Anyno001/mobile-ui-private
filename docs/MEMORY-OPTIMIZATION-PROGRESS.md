# 内存性能优化进度

## 当前状态

- 当前阶段：聊天历史保存链路
- 状态：完成，准备进入日历单 scope 写入阶段
- 修改范围：`public/mobile-ui-private`
- 提交规则：每阶段一个边界清晰的中文 commit，禁止 push

## 已确认问题

- 普通聊天保存必须在入队时冻结整库快照，避免排队期间运行时数据继续变化；该副本不能直接删除。
- 分支 scope 保存已经在目录队列内部持有独立 `merged` 数据，但 `coordinated` 路径仍会再次深拷整库。
- 普通保存遇到受保护 scope 时，队列已提供独立快照，合并持久化权威 scope 前又深拷一次整库，属于重复副本。
- localStorage 镜像和读取历史时的独立副本属于现有兼容与隔离契约，本阶段不删除。

## 本阶段目标

- 删除分支协调保存中的重复整库 `structuredClone`。
- 删除受保护 scope 合并前对队列私有快照的重复整库 `structuredClone`。
- 保持队列串行化、branch scope、IndexedDB/localStorage 镜像、失败补偿和存储 schema 不变。

## 验证与结果

- 已修改 `src/storage-history.js`，并由构建同步生成 `index.js`。
- `coordinated` 分支不再对队列内部新建且立即等待持久化的 `merged` 做第二次整库 `structuredClone`。
- 普通保存合并受保护 scope 时，直接修改 `enqueueDirectorySave` 已冻结的私有快照，不再先复制整库；受保护 scope 本身仍从当前 IDB 权威值独立克隆。
- 结构性收益：分支 scope 协调保存减少 1 次整库深拷；普通保存与分支 scope 交错时减少 1 次整库深拷。入队冻结、IDB 写入和 localStorage 序列化未减少，兼容语义保持不变。
- `npm run check:behavior`：通过。
- `npm run build && npm run check:contracts`：通过。
- `npm run check`：全量通过。
- `git diff --check`：通过，仅有 Git 的 LF/CRLF 工作区提示。
- 独立验收复测：`npm run check:behavior`、`npm run check:ai`、`npm run check` 与 `git diff --check` 均通过；队列恢复、branch scope 保护、失败补偿及 IDB/localStorage 契约未发现回归。
- 尚未在真实 SillyTavern 中采集浏览器 heap；本阶段只声明已确定的副本次数下降，不虚构字节收益。真实宿主内存对比保留到最终收口回归。

## 风险与回滚

- 风险：若协调调用方在持久化未完成前继续修改传入对象，去除副本会改变写入内容。
- 控制：已确认 `coordinated: true` 的历史调用仅位于 `commitDirectoryScope`，数据为队列内部新建的 `merged`，调用后立即 `await`，无外部共享写入。
- 普通路径仍由 `enqueueDirectorySave` 在入队前冻结整库快照；未删除排队隔离所需副本。
- 回滚：整体回退中文提交 `性能：减少聊天历史保存重复副本`，不涉及数据迁移。
- 提交策略：本阶段代码、构建产物与本进度记录一并提交；禁止 push。

## 下一阶段启动注意事项

- 本阶段完成并提交后，重新读取本文件、`AGENTS.md`、`BASELINE.md`、`LIFECYCLE-RESOURCES.md`，再进入日历单 scope 写入优化。
- 不得顺手修改其他存储模块；相似代码需在各自阶段重新确认所有权和调用链。
