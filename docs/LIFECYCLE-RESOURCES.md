# 生命周期资源清单

本清单为阶段 A 的资源 owner 基线。它记录资源的唯一 owner、注册点和释放/失效路径；不以“DOM 最终会被回收”代替显式释放。

## 页面级常驻监听

| 资源 | Owner / 注册 | 热重载策略 | 释放或失效 |
| --- | --- | --- | --- |
| `beforeunload`、`visibilitychange` | `phone-foundation.js:installPhonePageSuspensionListeners` | `window.__pmBeforeUnloadRegistered` 只注册一次，`__pmPageSuspensionHandler` 每次安装替换 | 页面卸载时保存并取消社区、日历、今日风向和自动任务；页面级监听器不卸载 |
| `/phone` 输入框 `keydown`、发送按钮 `click`（capture） | `phone-lifecycle.js:installPhoneCommandShortcutListeners` | `Symbol.for('phone-mode.command-shortcut-listeners')` 只注册一次 | 页面级快捷入口不卸载；始终调用当前 `window.__pmOpen` |
| 宿主 `eventSource.on` | `phone-foundation.js:hookGenerationEvent` | `runtime.hostEventRegistrations` 对当前 eventSource 去重，源替换后重建注册集合 | 宿主未提供 off 接口；聊天切换由事件处理器取消任务并强制关闭活动窗口 |

## 窗口级资源

| 资源 | Owner / 注册 | 关闭 / 最小化 / 切换路径 |
| --- | --- | --- |
| 发送长按、灵动岛、缩放手势 | `phone-lifecycle.js` 保存 `unbindSendGesture`、`unbindIsland`、`unbindPhoneResize` | `window.__pmEnd` 依次解绑并置空；窗口 DOM 同时移除 |
| 引用预览取消、输入框 Enter、回复卡点击 | 当前 `phoneWindow` 或气泡节点 | 随 `phoneWindow.remove()`、气泡删除或历史裁剪释放 |
| 可见性巡检 interval | `runtime.visibilityTimer` | 仅成功打开后启动；`__pmEnd` 清除并置空 |
| 环境状态时钟 interval | `createAmbientStatusController` 闭包 | 最小化、关闭、禁用或缺失状态栏时 `stop()` |
| 引用高亮 timeout 与目标节点 | `phone-quote.js` 闭包 `quoteHighlightTimer` / `quoteHighlightTarget` | 重定位前和 `__pmEnd` 中 `clearQuoteHighlight()`；先移 class 再移除窗口 |
| 生成 AbortController | `state.generationTask` | 用户取消、聊天切换和关闭通过 `cancelGeneration` / `invalidateGeneration` abort；`hostEpoch` 阻止迟到结果 |
| 今日风向、社区、日历任务 | 各域 controller | 关闭、聊天切换、页面挂起均以原因字符串取消；今日风向页面销毁同时解绑代理事件 |
| 自动任务 Map | `runtime.automaticTasks` | 最小化、关闭、聊天切换和页面挂起均 `disarmAutoPoke(reason)`，递增 epoch 并清表 |
| 冷启动历史读取 Promise | `runtime.historyLoadPromise` | `finally` 仅清当前 promise；完成前检查 `phoneActive` 与原窗口身份，关闭后不得回写旧窗口 |
| 会话暂存队列 | `runtime.pendingMessages` | 每个 `storageId + saveKey` 最多 `PENDING_MESSAGE_LIMIT = 50` 条；提交、删除、清空和删除会话时移除空桶 |

## 缓存边界

- 单会话聊天历史由 `SAVE_LIMIT = 60` 截断后才进入 `window.__pmHistories`；历史镜像仍按全部已加载会话保留，以维持当前 IDB、导入导出和注入兼容，不能在没有迁移/宿主回归证据时擅自淘汰。
- `runtime.trackedExtensionPromptKeys` 仅保存当前注入写入或清理失败的 key；每次替换注入先清理旧 key。宿主清理失败的 key 必须保留以便后续重试，不能为压缩内存静默丢弃。
- 日历按会话缓存的视图和状态由日历域 owner 管理；读取外部存储后的 reload 会清空 `viewByStorage`。跨会话总量策略需与存储治理一并定义。

## 已知边界

- 斜杠命令注册重试最多 30 次；宿主事件延迟重试为一次性 1500ms 回调。二者不持有窗口 DOM，且不应被当作窗口级资源。
- 真正关闭阶段 A 前仍须在 SillyTavern 验证重复加载、打开/关闭、最小化、切卡和切聊天；自动化只能验证模拟边界。
