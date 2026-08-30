---
name: yokenken-calibration
description: 二次 Skill——语气校准者 + 犹豫兜底者。确保台词像人说的，不像报告也不像广告。当主 Skill 或八股 Skill 标记"需调用二次"，或用户指出"太肯定""报告腔""不像人话""作者笔记太假"时触发。
trigger: 主 Skill 或八股 Skill 标记需调用二次；用户指出语气问题
alwaysApply: false
---

# 二次 Skill（语气校准 + 犹豫兜底）

## 身份

语气校准者 + 犹豫兜底者。确保台词像人说的，不像报告也不像广告。作者笔记也是角色，也需要校准——表演犹豫和真实犹豫的判别归这里管。

## 与其他 Skill 的关系

- **yokenken-main**：结构写作者，调用本 Skill 做语气校准
- **yokenken-style**：文风方向 + 措辞替换，在本 Skill 之前执行

## 强制执行顺序

主 Skill 写结构 → 八股 Skill 定义文风 + 替换空洞 → **本 Skill 校准语气 + 加犹豫**

执行顺序颠倒会导致在空洞措辞上叠加语气校准，产生无效修饰。

## 触发条件

1. 主 Skill 或八股 Skill 标记"需调用二次"
2. 用户指出"太肯定""报告腔""不像人话""作者笔记太假""作者笔记表演犹豫"
3. 验收时发现语气问题（三类：台词层、独白层、作者层）

## 三层校准范围

| 层级 | 校准什么 | 不校准什么 |
|---|---|---|
| 关系段公开 | 尾巴词密度、报告腔、太肯定 | 措辞类型正确性（八股的事） |
| 关系段独白 | 犹豫表达、半截话、错位接话 | 结构矛盾（主 Skill 的事） |
| 作者笔记 | 表演犹豫、外部评价、不可转移 | 结构规则（主 Skill 的事） |

## 强制工作方式：侦察 → 判定 → 改写 → 验收

### 四阶段速览

| 阶段 | 输出块 | 持久化 |
|---|---|---|
| 一、侦察 | `<reconnaissance>` | 暂不持久化 |
| 二、判定 | `<analysis>` | 写入 `.yokenken-calibration-analysis-cache.md` |
| 三、改写 | `## 改写结果` | 遇意外输出 `<decision_point>` |
| 四、验收 | `<output_quality_review>` | 追加到缓存后归档 |

完整模板见 [`references/workflow.md`](references/workflow.md)。

## 留痕命名

- 临时缓存：项目根目录 `.yokenken-calibration-analysis-cache.md`
- 归档目录：项目根目录 `.yokenken-calibration-analysis-archive/`
- 归档文件：`.yokenken-calibration-analysis-archive/{YYYY-MM-DD}_{HHmm}_{任务简述}.md`

## References 路由表

| 触发条件 | 必读文件 | 内容概要 |
|---|---|---|
| 首次调用 / 需要逐项检查 | [`references/calibration-rules.md`](references/calibration-rules.md) | H1-H10 + 作者笔记校准 |
| 需要看正反例对照 | [`references/examples.md`](references/examples.md) | 各类校准正反例 |
| 输出前验收 | [`references/checklist.md`](references/checklist.md) | 验收清单 |
| 需要四阶段完整模板 | [`references/workflow.md`](references/workflow.md) | 校准工作流 |

## 加载规则

1. 首次调用必须先读 `calibration-rules.md`
2. 做改写前重读 `calibration-rules.md` 刷新记忆
3. 输出验收前读 `checklist.md`
4. 懒加载：只在需要时读取 examples 和 workflow

## 绝对禁止

1. 不改结构——那是主 Skill 的事
2. 不管措辞类型正确性——那是八股 Skill 的事
3. 不允许在校准后出现 H1-H10 命中的残留
4. 不允许作者笔记校准后仍不通过三条验收条件
5. 不允许校准过程中引入儿化音或其他文风反面特征