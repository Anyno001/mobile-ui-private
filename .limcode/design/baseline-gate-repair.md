# 基线门禁专项修复设计

## 目标

修复当前已确认的三项既有门禁失败，使专项分支能够重新执行完整 `npm.cmd run check`，同时不改变今日风向业务范围、不新增持久化 schema、不引入第三方依赖。

## 范围

1. **主题 auxiliary 契约**：`src/config.js` 已采用同色系辅助色，且 `docs/CSS-TOKENS.md` 明确 auxiliary 是主题预设的相邻色或对比色。将 `scripts/check-behavior.mjs` 中残留的旧互补色期望对齐当前已落地实现；保留 auxiliary 与 accent 不相同的不变量。不得恢复已移除的互补色算法。
2. **空日历 prompt**：`renderCalendarContextInjection()` 当前会在空 calendar store 上生成文化节日事实，导致 `buildContextInjectionPrompts()` 产出日历 prompt。保持有真实日历/纪念日/节假日/天气/周期数据时的注入，只在没有任何可供用户配置或读取的日历事实源时抑制 prompt；开关诊断仍反映默认 scope 已启用。
3. **CSS governance**：以 `styles/*.css` 模块和当前 UI 标准为事实源，修复 `style.css` 聚合入口、`css-governance-registry.json` 的 important baseline/legacy registry 与模块 CSS 不一致，以及仍被契约识别的未登记值。仅做必要的 token/registry/聚合入口对齐，不借机重做视觉。

## 不在范围内

- 不修改 `todayTrend` 生成、调度、存储、备份、分支继承或版本号。
- 不修复与本专项无关的业务功能。
- 不以放宽 `check-contracts` 规则、删除断言或静默忽略错误来制造假绿。
- 不删除未提交的今日风向改动；基线修复文件必须能在 diff 中独立识别。

## 关键决策

- auxiliary 的源码值已由实现注释、CSS 文档和运行时消费链共同确认，修复测试期望而非回滚源码。
- 空日历以“是否存在至少一个真实事实源”为注入边界；纯计算文化节日不能在完全空 store 上单独触发 prompt。
- CSS registry 不把已经移除的规则继续当作基线；当前模块 CSS 的稳定 token、必要 `!important` 和已登记例外必须与聚合 `style.css` 一致。任何新增裸视觉值优先迁移到已有 token，只有确认是历史兼容边界才登记 legacy exception。

## 验收标准

- `npm.cmd run check:behavior`、`npm.cmd run check:permissions`、`npm.cmd run check:contracts` 全部通过。
- 今日风向专项 `check:today-trend`、`check:interactive`、`check:syntax`、`build` 不回归。
- `git diff --check` 通过；不得出现临时 runner、日志或生成物残留。
- 通过独立 Acceptance Expert 逐项复核；存在 blocking/major 时继续修复，不能把未收敛状态标记完成。