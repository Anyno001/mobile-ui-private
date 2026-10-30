# 天音小笺

个人自用项目，基于 [K20070831/sillytavern-phone-mode-1](https://github.com/K20070831/sillytavern-phone-mode-1) 的二次创作。
感谢 [namelessone88/story-oracle](https://github.com/namelessone88/story-oracle)、[JulyXP3/story-oracle-patch](https://github.com/JulyXP3/story-oracle-patch) 与 [DlSNlGHT/World](https://github.com/DlSNlGHT/World) 三位作者的借物。

## 安装

1. 打开 SillyTavern 的扩展管理页面。
2. 使用以下 Git 仓库地址安装：

    https://github.com/Anyno001/mobile-ui-private

3. 安装后输入 `/phone` 启动。
4. 可以在设置页面固定 `/phone`，方便后续启动。

### 用酒馆助手自动加载最新版

不想在扩展管理里安装、或想每次刷新都用上最新版时，可以改用酒馆助手脚本：

1. 下载 [loader/tianyin-loader.json](https://github.com/Anyno001/mobile-ui-private/blob/main/loader/tianyin-loader.json)。
2. 在酒馆助手的「脚本库」里导入为全局脚本并启用。
3. 刷新酒馆页面，输入 `/phone` 启动。

脚本每次打开酒馆时读取 GitHub 上 main 分支的最新提交，从 jsDelivr 下载对应的程序与样式；版本号缓存 10 分钟，连不上 GitHub 时沿用上次的版本。扩展管理里已经装过天音小笺时，脚本自动跳过，不会出现两个手机。

## 说明

- 仅用于个人自用维护。
- 备份可能包含 API Key 和聊天数据，请勿公开。
