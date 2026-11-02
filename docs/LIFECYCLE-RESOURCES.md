# 生命周期资源清单

本清单为当前版本的资源 owner 基线。它记录资源的唯一 owner、注册点和释放/失效路径；不以“DOM 最终会被回收”代替显式释放。

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
| 社区文件上传防抖 | `community-file-sync.js` 的 `uploadTimer`（1500ms） | 社区保存成功后排队；`flushCommunityFiles` 在关闭手机与页面挂起时立即上传并清计时器；上传失败留待下次改动或对账，不自建重试 |
| 聊天元数据写入防抖 | 酒馆 `saveMetadataDebounced`（owner 为宿主，插件不自建计时器） | IndexedDB 写成功后同步 `chatMetadata.tianyin_phone` 并调用宿主防抖；关闭手机与页面挂起时 `flushChatMetadata` 立即 `saveMetadata`；宿主切换聊天时自行取消防抖，未写入的改动由下次对账按本地时间戳补写 |
| 生图任务与图片卡监听 | `phone-image-controller.js:installPhoneImages`：`jobs` Map（每个任务一个 AbortController）、串行 `queue`、`pendingShots`；`phoneWindow` 上的 click / error（capture）监听挂在 `lifecycle` AbortController 上 | `__pmEnd` 调 `destroyPhoneImages`：abort 监听与全部在途任务，清空任务表和未发送的「拍一张」；已上传的图留在目录里 |
| 相册页监听与目录订阅 | `phone-gallery.js:installPhoneGallery`：`lifecycle` AbortController + `store.subscribe` 返回的退订函数；`renderSerial` 作废迟到的渲染与缩略图读取 | `__pmEnd` 调 `destroyPhoneGalleryUi`：abort、退订、递增 `renderSerial` |
| 与 gal 前端联动（IGS） | `igs-feed-sync.js:installIgsFeedSync`：宿主消息事件经 `phone-host-events.js` 的 `igs:*` 注册调用 `observe`；同一批事件以微任务合并成一轮（不建计时器）；「同步后自动续写」一次只跑一个，各带自己的 AbortController；IGS 未启动时只往 `window.IGS_DLC` 推一次回调 | 总开关关闭时 `observe` 直接返回、不碰 `window.IGS`；关闭开关或切到别的聊天时 abort 进行中的续写，迟到结果按 storageId 丢弃 |
| 图片元数据写入防抖 | 酒馆 `saveMetadataDebounced`（插件不自建计时器） | 写入 `chatMetadata.tianyin_phone_images` 后调用宿主防抖；与聊天记录共用宿主的防抖与保存时机 |
| 桃宝生成任务与页面监听 | `shop-app.js:installShopApp`：上新与更多评价各带一个 AbortController，挂在社区运行时的 `requestController` 上并占用同一把 `runtime.busy`（与社区、直播互斥）；页面 `[data-phone-page="shop"]` 首次打开时创建，click / submit 监听挂在该节点上 | 「停止」、关闭手机、切换聊天由社区的 `invalidate` 一并 abort；结果提交前核对 requestId 与 storageId，迟到结果丢弃；窗口关闭时页面节点随窗口移除，监听一起释放 |
| 金手指核心监听与界面订阅 | `origin-host.js:startOriginHost`（启动时一次）：核心 `getSharedOriginEngine` 按总开关在酒馆 eventSource 上挂/卸监听，不建计时器；`origin-app.js:installOriginApp`：页面 `[data-phone-page="origin"]` 首次打开时创建并挂 click / submit / change / keydown，打开时 `engine.subscribe` | 总开关关闭时核心解绑全部监听；离开 App、回桌面、关闭手机时退订（`__pmEnd` 调 `destroyOriginApp`）；`release()` 撤下本方 host，最后一个 host 撤下时核心解绑 |
| 格林推演页面监听 | `greenlin-app.js:installGreenlinApp`：页面 `[data-phone-page="greenlin"]` 首次打开时创建，只挂 click 监听；不订阅宿主事件、不轮询、不建计时器。数据库插件的推演账本只在打开与刷新键点按时读一次；「较上次」快照（v2：revision、天数、世界事件 id 与 revision/状态摘要、人物当前动作、确定事实 id、历史 id，另保留旧栏目字段；缺字段的旧快照按首次打开处理）存 localStorage `ST_SMS_GREENLIN_SEEN`（按聊天分开，不进备份与美化包） | 切换聊天时手机整体关闭（`__pmEnd` 调 `destroyGreenlinApp`，清空会话状态与基准），下次打开重新读取；关闭手机时页面节点随窗口移除，监听一起释放；清空全部数据时该键随 `PLUGIN_LOCAL_STORAGE_KEYS` 删除 |
| 剧情注入器运行时与计时器 | `plot-injector/plot-injector.js:startPlotInjector`（启动时一次，`deps.plotInjector`）：`plot-runtime.js` 在酒馆 eventSource 上挂 9 个监听（条目加载、切聊天、收发/改/删/滑楼、生成开始/结束/停止）；计时器只有三种，都是一次性 timeout：兜底注入书写入 `fallbackTimer`（1000ms，仅酒馆无条目加载事件时）、主回复生成中挂起检测 `pendingTimer`（最长 30s）、检测失败重试间隔（2s，最多 3 次）；`plot-data.js` 文件防抖写入每个文件一个 800ms timeout；`plot-injector.js` 提示卡 `timeout` 自动收起 | 切聊天清 `pendingTimer`；页面挂起时 `deps.plotInjector.flush()` 立即写出防抖文件；`destroy()` 解绑监听、清全部计时器与提示订阅。同页有独立版剧情注入器（`__plotInjector`）时各监听直接返回，不注入、不检测、不建计时器 |
| 视频播放计时器与回应高亮 timeout | `video-app.js` 闭包 `timer`（250ms interval，仅点播放时创建）、`freshTimer`（1800ms） | 暂停、播放结束、回首页、切到直播分区、回桌面、打开另一条视频、重新打开手机均 `stopPlayback()` 清除；计时回调发现页面不在噼哩噼哩、页面隐藏、手机最小化或关闭、视频已不存在时自行停止并重绘播放按钮；高亮 timeout 每次重设前先清除 |
| 会话暂存队列 | `runtime.pendingMessages` | 每个 `storageId + saveKey` 最多 `PENDING_MESSAGE_LIMIT = 50` 条；提交、删除、清空和删除会话时移除空桶 |

## 缓存边界

- 单会话聊天历史不再截断，完整进入 `window.__pmHistories`（界面只渲染最近 `HISTORY_RENDER_LIMIT = 200` 条，可分批展开）；历史镜像仍按全部已加载会话保留，以维持当前 IDB、导入导出和注入兼容，不能在没有迁移/宿主回归证据时擅自淘汰。
- `runtime.trackedExtensionPromptKeys` 仅保存当前注入写入或清理失败的 key；每次替换注入先清理旧 key。宿主清理失败的 key 必须保留以便后续重试，不能为压缩内存静默丢弃。
- 日历按会话缓存的视图和状态由日历域 owner 管理；读取外部存储后的 reload 会清空 `viewByStorage`。跨会话总量策略需与存储治理一并定义。

## 已知边界

- 斜杠命令注册重试最多 30 次；宿主事件延迟重试为一次性 1500ms 回调。二者不持有窗口 DOM，且不应被当作窗口级资源。
- Today Trend 的 20 步 Node 长序列验证确定性重放与公开 owner 契约。阶段 0 的真实宿主重复回归已由助手基于当前已测试版本明确豁免；阶段 1 无 UI/AI 可见变化，仅验证 authority/CAS 资源 owner。真实 DOM、listener、AbortController 与宿主资源循环验收保留到实际修改生命周期/UI 的阶段及最终发布阶段。
- Today Trend v2 的 `BroadcastChannel` 仅承担失权通知，不提供写入正确性。channel 在 authority `acquire` 时按需创建，由 `release` 或 `close` 显式释放；默认三开关关闭且未获取 authority 时不注册 channel。最终写入资格始终由单个 IndexedDB `readwrite` 事务中的 CAS 判定。
- `pmOpenIDB` 由模块级 `database` 与 `openingPromise` 共同持有连接生命周期：首次并发调用共享 pending open；`versionchange` handler 捕获并关闭所属连接，只有缓存仍指向该连接时才清空 `database`，避免旧连接误关后来连接。
- authority 状态不可读取时 Today Trend v2 兼容桥读写均 fail-closed，不持有或返回无法证明新旧程度的 v1 fallback；恢复动作必须先修复 `PhoneModeDB/kv` 可读性，再重新加载。
