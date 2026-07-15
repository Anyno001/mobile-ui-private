# 天音小笺

这是个人自用的手机聊天界面维护项目，基于 [K20070831/sillytavern-phone-mode-1](https://github.com/K20070831/sillytavern-phone-mode-1) 继续维护。项目使用“天音小笺”作为独立名称，不作为上游原版发行。

## 安装

1. 打开宿主的扩展管理页面。
2. 选择从 Git 仓库 URL 安装第三方扩展。
3. 使用以下地址：

    https://github.com/Anyno001/mobile-ui-private

4. 安装完成后输入 `/phone` 打开天音小笺。`/phone` 是为兼容旧用法保留的命令，不是项目名称。

## 常用格式

- `/` 分隔多条消息，例如：`你好/在吗`
- 转账：`(转账+50)`
- 图片：`(图片+一只猫)`

## 来源与使用边界

- 上游作者及代码来源：`K20070831/sillytavern-phone-mode-1`。
- 当前维护者：`Anyno001`。
- 本项目仅用于个人自用维护，不作为上游原版发行。
- 本仓库保留上游提交历史，但不是 GitHub 页面标记的 Fork。
- 上游当前未提供公开 LICENSE；当前维护者已取得上游作者许可，可将本派生版本放入本人仓库维护。本仓库继续保留来源署名，不将上游代码冒充为原创。

## 隐私警告

新导出的 `TianyinXiaojian_Backup_*.json` 和旧版 `PhoneMode_Backup_*.json` 都可能包含 API 地址、API Key、配置和聊天数据。不要把备份文件、`.env`、浏览器数据库或个人配置提交到 Git。

## 开发

维护源码位于 `src/`，根目录 `index.js` 是供宿主加载的构建产物。修改源码后执行：

    npm ci
    npm run build
    npm run check

不要手工编辑生成的 `index.js`。
