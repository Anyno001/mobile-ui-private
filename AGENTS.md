# Repository Agent Instructions

## UI / CSS 强制规则

修改以下任一内容前，执行者必须先读取：

1. `docs/CSS-TOKENS.md`
2. `docs/BASELINE.md`

适用范围包括：

- `style.css`
- HTML 或 JavaScript 模板中的 class 与内联样式
- `element.style`、`style.setProperty`
- SVG 的颜色、尺寸和描边
- 媒体查询、动画、定位、层级与交互状态

执行要求：

- 以 `docs/CSS-TOKENS.md` 的目标 UI 标准为准，不得复制或迁就历史不一致样式。
- `docs/BASELINE.md` 仅保护宿主、运行时和兼容契约，不保护旧视觉。
- 新增或修改 UI 时必须使用已落地的语义 token；缺失 token 时，应在同一变更中先定义 token，再迁移组件并补充契约检查。
- token 必须少而稳定，不得为单个组件随意增加全局变量；优先使用文档现有语义和标准组件配方。
- 修改前必须搜索目标组件的全部选择器、覆盖规则、内联样式、运行时样式写入和调用方。
- 必须覆盖亮色、暗色、focus-visible、disabled 和移动端；按组件能力覆盖 hover、active、loading、invalid、readonly 与 autofill。
- 不得新增未登记的裸颜色、透明度、字号、间距、圆角、阴影、z-index 或动画时长。
- 不得通过缩小字体、压缩触控区域、堆叠卡片/描边/阴影或增加高饱和颜色制造所谓“简约”。
- 可机器验证的标准必须同步写入 `scripts/check-contracts.mjs`。
- 完成后必须运行构建、语法检查、契约检查和 `git diff --check`；失败不得隐瞒或绕过。

## Git 推送约定

- GitHub HTTPS 推送优先使用本机 Git Credential Manager 完成浏览器登录，不在远端 URL、仓库配置或对话中写入 Token、密码等凭据。
- 当前已验证可用的代理路径为 `http://127.0.0.1:8890`；推送命令使用：`git -c http.proxy=http://127.0.0.1:8890 -c https.proxy=http://127.0.0.1:8890 push --porcelain origin HEAD:main`。
- 推送成功后必须执行同代理的 `git ls-remote origin refs/heads/main`，核对远端提交哈希与本地 `git rev-parse HEAD` 一致；推送超时也必须先核对远端指针，禁止直接重复推送。
- 若代理端口可连接但 HTTPS 推送无响应，先确认 Git Credential Manager 已有 GitHub 账号或通过 `git credential-manager github login --browser` 登录；连续两次同类失败后停止重试并报告根因，不绕过认证。

若本文件与 `docs/CSS-TOKENS.md` 冲突，以后者的具体 UI 标准为准；若与 `docs/BASELINE.md` 的运行兼容契约冲突，必须停止并先明确变更影响。
