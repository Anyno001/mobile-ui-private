# 原版静态基线

基线提交：`0dc8538 Update index.js`

此文件记录模块化前必须保持的关键契约。它不能替代 SillyTavern 中的实际回归测试。

## 入口与生命周期

- `manifest.json` JavaScript 入口：`index.js`
- 异步 IIFE 启动，初始等待 1000ms
- `/phone` 斜杠命令及输入框拦截必须保留
- 全局入口：`window.__pmOpen`
- 启动日志包含：`[phone-mode] v9.5.7`

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
