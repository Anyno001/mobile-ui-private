# 内存性能优化进度

## 当前状态

- 当前阶段：日历单 scope 写入
- 状态：完成，准备进入 Today Trend 调度快照阶段
- 修改范围：`public/mobile-ui-private`
- 提交规则：每阶段一个边界清晰的中文 commit，禁止 push

## 已确认问题

- `commitScope`、`commitRecipe`、`commitOutfits`、`commitOccasions`、`commitSchedule` 与 `commitCycle` 修改单个 `storageId` 时，原实现会克隆或规范化完整 store。
- scope 数量接近模型上限 80 时，单 scope 提交会为无关 scope 创建不必要的瞬时副本。
- `commitStore` 属于真实整库事务，仍需保留整库克隆；本阶段不能把单 scope 优化错误扩展到整库导入或批量替换路径。
- 回滚必须保留 generation 所有权、任务取消、注入失败补偿与 runtime/持久化一致性，不能用减少副本换取旧事务覆盖新状态。

## 本阶段目标

- 单 scope 提交仅向 mutator 暴露目标 scope，并只复制必要的顶层 store/scopes 容器。
- 保持 storage key、持久化 schema、runtime 赋值、normalize 时机、队列串行化、generation、取消和失败补偿语义。
- 用 80 scopes、多 scope 隔离、故障回滚和 generation 竞态测试约束优化边界。

## 验证与结果

- 已修改 `src/calendar-commit.js`、`scripts/check-calendar.mjs`、`scripts/check-contracts.mjs`，并由构建同步生成 `index.js`。
- 新增 `replaceScope`：只规范化目标 scope，并通过顶层浅复制合并；非目标 scope 不再因单 scope 提交被整库深拷。
- 六类单 scope 提交器均改为目标 scope 输入与局部合并；`commitStore` 的整库事务逻辑保持不变。
- `commitOutfits` 保持成功时返回完整 store 的既有可观察语义；runtime 仍在持久化成功后赋值。
- 80 scopes 测试已覆盖 calendar、recipe、outfit、occasion、schedule 双 store 与 cycle，验证目标更新、非目标隔离及必要的持久化/runtime 一致性。
- generation 竞态测试已覆盖 occasion、schedule 与 cycle；原有 calendar/recipe 的取消、导入接管、清空接管和注入失败补偿测试继续通过。
- 结构性收益：单 scope 提交不再创建与 scope 总数成正比的深拷副本，提交层额外对象分配收敛为目标 scope 加必要顶层容器。localStorage 序列化仍需处理完整 store，不虚构持久化层字节收益。
- `node scripts/check-calendar.mjs`：通过。
- `node scripts/check-contracts.mjs`：通过。
- `npm run check`：全量通过。
- `git diff --check`：通过，仅有 Git 的 LF/CRLF 工作区提示。
- 两轮独立验收完成；第二轮结论为 `accepted`，未发现阻断交付问题。
- 尚未在真实 SillyTavern 中采集浏览器 heap；本阶段只声明已由代码结构和测试证明的整库深拷消除，不虚构峰值字节数。真实宿主内存对比保留到最终收口回归。

## 风险与回滚

- 风险：`commitOccasions` 与 `commitSchedule` 的失败补偿仍会恢复入口时的完整 store；当前由统一 schedule 队列和 generation 所有权保护约束，未来新增旁路写入时必须重新审查。
- 控制：generation 丢失后旧事务不会执行入口快照回滚；多 scope、注入失败、部分回滚失败和替换接管测试已覆盖当前所有权模型。
- `index.js` 是 `manifest.json` 指向的生产入口，必须与源码和测试一起交付；当前构建合同已验证 bundle 与源码同步。
- 回滚：整体回退本阶段日历单 scope 优化提交，不涉及 schema、storage key 或数据迁移。
- 提交策略：本阶段代码、构建产物与本进度记录一并提交；禁止 push。

## 下一阶段启动注意事项

- 本阶段完成并提交后，重新读取本文件、`AGENTS.md`、`BASELINE.md`、`LIFECYCLE-RESOURCES.md`，再进入 Today Trend 调度快照优化。
- 不得顺手修改其他存储模块；相似代码需在各自阶段重新确认所有权和调用链。
