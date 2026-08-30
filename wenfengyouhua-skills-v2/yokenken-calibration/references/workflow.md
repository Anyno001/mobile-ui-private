# 语气校准强制工作流

> **加载时机**：执行校准任务前必读。

---

## 总则

四阶段：侦察 → 判定 → 改写 → 验收。

| 阶段 | 输出块 | 持久化 |
|---|---|---|
| 一、侦察 | `<reconnaissance>` | 暂不 |
| 二、判定 | `<analysis>` | 写入 `.yokenken-calibration-analysis-cache.md` |
| 三、改写 | `## 改写结果` | 遇意外追加 `<decision_point>` |
| 四、验收 | `<output_quality_review>` | 追加缓存后归档 |

## 留痕命名

- 临时缓存：`.yokenken-calibration-analysis-cache.md`
- 归档目录：`.yokenken-calibration-analysis-archive/`
- 归档文件：`.yokenken-calibration-analysis-archive/{YYYY-MM-DD}_{HHmm}_{任务简述}.md`

---

## 阶段一：侦察

```
<reconnaissance>
target_section: [校准哪一层：公开/独白/作者笔记]
trigger_point: [具体触发位置]
relation_pressure: [关系压力方向]
emotional_energy: [情绪能量级：高/中/低]
character_awareness: [角色可知范围]
</reconnaissance>
```

---

## 阶段二：判定

```
<analysis>
target: [待校准文本]
hits: [H1-H10 及作者笔记校准命中项]
non_hits_checked: [逐项确认未命中的H编号]
approach: [选择的承担方式]
affected_scope: [逐句列出需要改写的位置]
execution_plan:
  - step_1: [具体改写方案]
degradation_check:
  - 是否引入儿化音？ → [YES/NO]
  - 是否引入文风反面特征？ → [YES/NO]
  - 作者笔记（如有）是否通过三条验收条件？ → [逐项检查]
</analysis>
```

分析硬规则：
- 原文必须逐句引用作为证据
- non_hits_checked 必须覆盖 H1-H10 全部 + 作者笔记校准
- affected_scope 必须逐句列出
- 不允许"其余同理"
- H7/H8/H9 命中时必须补触发点

---

## 阶段三：改写

输出 `## 改写结果`，放置改写后的文本。

执行硬规则：
- 改写结果禁用黑名单中的句式
- 遇意外输出 `<decision_point>`
- decision_point 追加写入缓存

---

## 阶段四：验收

```
<output_quality_review>
h1_h9_residue: [H1-H10 逐项检查结果]
author_note_check:
  - 指向具体台词？ → [YES/NO]
  - 待解问题可检验？ → [YES/NO]
  - 不可转移？ → [YES/NO]
style_check:
  - 儿化音？ → [YES/NO]
  - 报告腔？ → [YES/NO]
  - 太肯定？ → [YES/NO]
final_decision: [PASS / FAIL]
</output_quality_review>
```

验收硬规则：
- FAIL 必须回到执行阶段重写
- final_decision 为 PASS 时所有项必须通过
- 禁止整体通过但局部仍有残留

验收通过后：缓存追加验收报告 → 创建归档目录 → 移动缓存为归档文件。

---

## 最小展示模式

用户要求只给结果时，最小输出：

```
## 改写结果
[改写后文本]
## 简短自检
[H1-H10 残留 + 作者笔记三条验收 + 文风反面特征]
```