# 原版静态基线

基线提交：`0dc8538 Update index.js`

此文件记录模块化前必须保持的关键契约。它不能替代 SillyTavern 中的实际回归测试。

## 入口与生命周期

- `manifest.json` JavaScript 入口：`index.js`
- 异步 IIFE 启动，初始等待 1000ms
- `/phone` 斜杠命令及输入框拦截必须保留
- 全局入口：`window.__pmOpen`
- 启动日志包含：`[phone-mode] v9.5.7`

## 安装顺序与全局桥

- 安装顺序固定为：`installPhoneFoundation → installConversation → installEmojiUi → installInteractiveScenes → installCalendar → installSettingsUi → installPhoneChat → installPhoneContextInjection → installPhoneControlCenter → installPhoneDirectory → installContactGenerator → installPhoneChatPoke → installPhoneLifecycle → installDiagnosticApi → installTodayTrend → installTodayTrendPhoneUi`
- `main.js` 只能作为组合根，不得定义 `window.__pm*`。
- `window.__pmHistories`、`window.__pmConfig`、`window.__pmTheme`、`window.__pmInjectionConfig`、`window.__pmBudgetConfig` 在 foundation 安装时初始化；初始化必须保留既有运行时值，并由各自存储边界随后加载或规范化。
- `window.__pmBeforeUnloadRegistered` 与 `window.__pmPageSuspensionHandler` 归 foundation 的页面挂起监听管理；前者保证监听器只注册一次，后者允许热重载时替换为当前依赖。
- 模板直接调用的 `window.__pm*` API 必须有单一源码 owner，并由 `check:contracts` 校验其存在性和归属。

## 构建体积基线

- 历史合同基线：`index.js` 为 `1240219` bytes；其 120% 为 `1488263` bytes（向下取整），该数值仅作为历史参考线，不是当前构建、阶段完成或发布的硬失败阈值。
- Today Trend v2 阶段 0 于 2026-08-12 使用当前 `npm run build` 实测 `index.js` 为 `1377215` bytes；该数值是实施前观测点，用于计算后续净增量，不要求新增功能维持原体积。
- 2026-08-25 的 StageProjection 契约修复后，`npm run build` 实测 `index.js` 为 `1624993` bytes，较阶段 0 增加 `247778` bytes；本次记录用于阶段 12 的体积审查，不将历史参考线重新解释为硬阈值。
- 阶段 1 已实现默认关闭的 `readV2`、`writeV2`、`serveV2`、独立 v2 store/authority key 与单事务 CAS；authority 不存在时兼容 v1，authority 状态不可确认时读写均 fail-closed。
- 每阶段记录当前 bundle、相对阶段 0 的净增量和主要增长来源；异常跃升必须审查重复实现、错误打包、无界依赖与死代码，但禁止仅为迎合旧参考值删除或晦涩化功能、校验、错误信息、可维护结构或 CSS。
- bundle 观测不能替代真实宿主中的首开、首渲染、交互性能、内存与资源测量。完整 v2 取得真实数据后，才能评估是否建立新的容量预算。

当前检查基线：`check:syntax`、`check:today-trend`、`check:contracts`、`check:budget`、`check:interactive` 通过；`check:calendar` 在阶段 0 修改前已因“当日日程重新生成按钮 SVG/aria 契约”失败，`check:permissions` 在本轮 bundle 治理前已因“空数据不得生成日历 prompt”失败。两项均属于既有日历域基线，不得归因给 Today Trend v2，也不得在本阶段顺手修复。

## 持久化契约

- IndexedDB 数据库：`PhoneModeDB`
- IndexedDB store：`kv`
- 历史主键：`ST_SMS_DATA_V2`
- 社区副本：酒馆 `user/files/tianyin-community-<编号>.json`（每个聊天一份，编号由 storageId 哈希，文件内另存 storageId 核对）与 `tianyin-community-templates.json`（共享模板），不进聊天记录；本地改动时间记在 localStorage `ST_SMS_COMMUNITY_FILE_STAMPS_V1`，对账规则同聊天元数据。
- 删楼回退：手机消息带 `floor`（发送时主线 chat.length）与 `floorAnchor`（该楼最后一条消息的 is_user/send_date/name）；最近 N 层（localStorage `ST_SMS_ROLLBACK_FLOORS`，默认 30，0 为不保留）内编辑、删除、重新生成的旧版本存于 `chatMetadata.tianyin_phone.rollback`，按层数与每层约 3.4KB 封顶。
- 聊天元数据副本：`chatMetadata.tianyin_phone`（当前聊天的联系人记录与群聊元信息，每个联系人最近 2000 条）是 IndexedDB 之外的第二份副本，不替代 IndexedDB；本地改动时间记在 localStorage `ST_SMS_CHAT_METADATA_STAMPS_V1`，对账时两边都有且不同则 `updatedAt` 新的整份为准。
- 生图：图片本体存酒馆 `user/images/tianyin-phone/`，不存浏览器。`PhoneModeDB/kv` 里存目录 `ST_SMS_IMAGE_CATALOG_V1`、手机自建的角色形象 `ST_SMS_IMAGE_DNA_V1` 和缩略图 `ST_SMS_IMAGE_THUMB_<id>`；设置存 localStorage `ST_SMS_IMAGE_SETTINGS_V1`（version 2：全局方案、至多 12 个预设方案、聊天/社区/视频各自选用的方案；内置 NAI 的 Key 与手机聊天 API 的 Key 一样存在本机，不写进聊天文件；v1 的比例读入时并进全局方案）。当前聊天的目录（不含提示词与缩略图）另存 `chatMetadata.tianyin_phone_images`，打开相册或渲染图片卡时把本机缺的记录补回。角色形象（DNA）由手机独立保存，不读写其他插件的资料。
- 桃宝：`PhoneModeDB/kv` 主键 `ST_SMS_SHOP_V1`（version 1，按 storageId 分 scope：商品、购物车、订单），IndexedDB 不可用时写 localStorage `ST_SMS_SHOP_V1_LOCAL_FALLBACK`；读不懂的数据不覆盖、本次改动不保存。不进互动社区 store；备份字段 `shop` 可选，旧备份没有时保留现有数据。
- Today Trend v2 主键：`ST_SMS_TODAY_TREND_V2`；authority key：`ST_SMS_TODAY_TREND_V2_AUTHORITY_V1`；二者不得与 v1 key 混用。
- v2 authority 与 store 的 guard compare / writes 必须在同一个 `readwrite` 事务内完成；冲突事务不得留下部分写入。
- authority 存在 active owner 时，其他标签不得通过 `acquire` 接管；必须由当前 owner 显式 `release` 后再竞争获取，阶段 1 不提供 lease、超时或 takeover。
- authority 不可读取时不得回退读取或写入 v1；否则无法证明 v1 与潜在 v2 数据的新旧关系。恢复前提是重新获得 `PhoneModeDB/kv` 的可靠读取能力。
- `pmOpenIDB` 的首次并发调用共享同一个 pending open；`versionchange` 只关闭事件所属连接，并且只有该连接仍是当前缓存时才清空缓存。
- 原存储键与迁移标记不得在纯模块化阶段更名

## CSS 契约

- 手机根选择器：`#pm-iphone`
- 遮罩选择器：`#pm-overlay`
- 模型列表：`.pm-model-options`
- 模型列表高度由 JavaScript 常量 `MODEL_VISIBLE_ROWS` 写入 CSS 变量，CSS 默认值为 4，每行高度为 `34px`
- 移动端媒体查询：`@media(max-width:500px),(max-height:700px)`

## 人工回归清单

- `/phone` 打开、最小化和关闭
- 单聊发送、AI 回复、刷新后历史恢复
- 群聊创建、编辑、发送和删除
- 主题、暗色模式、背景和头像裁剪
- 表情包导入与发送
- 拍一拍与双向记忆
- 数据导入导出
- 浏览器控制台无新增错误
