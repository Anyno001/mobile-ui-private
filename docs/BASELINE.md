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

- 基线 bundle：`index.js` 为 `1240219` bytes；静态合同允许的上限为 `1488263` bytes（基线的 120%，向下取整）。
- 此上限只用于阻止无审查的体积跃升，不替代真实宿主中的首开、首渲染和交互性能测量。调整上限必须同时说明增长来源、宿主回归结果和新的基线值。

## 持久化契约

- IndexedDB 数据库：`PhoneModeDB`
- IndexedDB store：`kv`
- 历史主键：`ST_SMS_DATA_V2`
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
