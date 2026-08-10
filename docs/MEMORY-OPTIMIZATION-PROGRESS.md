# 内存性能优化进度

## 当前状态

- 当前阶段：Today Trend 调度快照静态交付完成，等待真实宿主定向回归
- 上一阶段：日历单 scope 写入已落地（提交 `8ddac3f`）
- 修改范围：`public/mobile-ui-private`
- 提交规则：本阶段创建独立中文 commit，禁止由 Agent push；助手 push 后再执行真实宿主回归

## 阶段启动基线

- 已重新读取 `AGENTS.md`、`docs/BASELINE.md`、`docs/LIFECYCLE-RESOURCES.md`、本进度文档与 Today Trend 调度调用链。
- 阶段开始前已删除临时宿主回归脚本；仓库工作树、暂存区与未跟踪文件均为空，HEAD 与 `origin/main` 同为 `8ddac3f`。
- 原实现将全部有效消息正文拼接进 observation key，稳定驻留和每次观察的中间分配随正文总字符数增长。
- 宿主同一同步批次可派发重复消息事件；仅延迟到微任务读取不能避免重复扫描完整聊天。

## 本阶段实现

- `src/today-trend-scheduler.js` 改为单次遍历聊天并生成固定 128-bit 会话指纹，不再创建完整有效消息数组、摘要数组或正文拼接 key。
- 快照保留 `messageCount`、`assistantCount`、`lastRole`、末消息 128-bit 指纹，并将角色、消息序号、正文长度和消息边界纳入指纹协议。
- observation 记录访问顺序和时间，状态表上限为 80；只淘汰非当前会话、非活动任务且无 pending turns 的最旧项。存储中已不存在的 scope 会清理孤儿状态。
- `src/phone-host-events.js` 合并同一同步批次的重复 Today Trend 观察请求，在单个微任务中读取最终聊天快照，避免重复全量扫描。
- 保留完整 assistant 楼层累计、编辑/删除/滑动重生成语义、自动与手动生成链、活动任务保护、pending turns 补调度及迟到结果隔离。
- `index.js` 已通过构建从源码同步生成；未改变持久化 schema、storage key 或公开入口。

## 验证与结果

- `node scripts/check-today-trend.mjs`：通过。
- `npm run check`：全量通过；构建、语法、AI、表情、行为、互动、pending、手势、环境、裁剪、日历、预算、权限、静态契约与 Today Trend 检查均通过。
- `git diff --check`：通过，仅有 Git 的 LF/CRLF 工作区提示。
- 新增检查覆盖：固定 32 hex 会话/末消息指纹、快照序列化小于 512 bytes、长正文和消息数不扩大快照、角色域与消息边界、80 项容量、孤儿 scope 清理、重复宿主事件合并。
- 原有检查继续覆盖：完整 assistant 楼层累计、编辑、删除、重生成、重复观察、自动/手动生成、活动任务期间累计、取消、并发替换和迟到提交保护。
- 结构性收益：稳定 observation 从随正文总字符数增长收敛为固定大小；快照构造从多次数组遍历与大字符串拼接收敛为单次流式扫描。静态检查不虚构真实浏览器峰值字节或 P95。

## 风险与回滚

- 128-bit 指纹用于变化检测而非安全认证；碰撞概率已显著降低，但不宣称密码学安全。
- 当 80 项全部受当前会话、活动任务或 pending turns 保护时，状态表允许暂时超限，任务完成或状态可淘汰后再次裁剪，避免为硬上限吞掉调度状态。
- 真实 SillyTavern 仍需验证自动调度、编辑/删除/重生成、重复宿主事件、控制台错误及长聊天内存表现。
- 回滚：整体回退本阶段提交，不涉及数据迁移。

## 下一阶段启动注意事项

- 助手 push 本阶段 commit 后，先执行 Today Trend 真实宿主定向回归并记录结果；通过后再进入背景与图片资源阶段。
- 背景阶段开始前必须重新读取项目文档及背景、Cropper、object URL 的实际 owner 与释放路径，不得顺手修改其他存储域。
