# 主 Skill 强制工作流程：侦察 → 分析 → 执行 → 验收

> **加载时机**：接手人设生成/角色卡任务前必须读取本文件并按四阶段顺序执行。不允许跳过任何阶段。

> **留痕命名**：所有缓存与归档使用 `.yokenken-` 前缀。
> - 临时缓存：项目根目录 `.yokenken-analysis-cache.md`
> - 归档目录：项目根目录 `.yokenken-analysis-archive/`
> - 归档文件：`.yokenken-analysis-archive/{YYYY-MM-DD}_{HHmm}_{任务简述}.md`

---

## 阶段一：侦察

输出 `<reconnaissance>` 块（放在 markdown 代码块内）：

```
<reconnaissance>
goal: [需要了解什么才能写出合格的角色卡]
mode: [成品版 / 进阶版 / 极简版]
mode_reason: [选择该模式的理由]
actions:
  - read: [需要读取的前文/参考/用户提供的角色信息]
  - clarify: [需要向用户澄清的关系/时间线/状态变量]
  - check: [需要确认的叙述视角、已有设定、前文约束]
</reconnaissance>
```

然后调用工具收集信息。

---

## 阶段二：分析

基于侦察结果输出 `<analysis>` 块。以下字段必须完整填写：

**持久化要求（强制·逐字复制）**：`<analysis>` 块输出后，必须逐字复制写入 `.yokenken-analysis-cache.md`。

```
<analysis>
context: [从侦察中了解到的关键事实]
needs: [用户的本质需求]
key_challenges: [基于实际文本发现的核心难点]
confidence: [HIGH / MEDIUM / LOW + 理由]
approach: [选择的写法 + 三维评分]
  三维评分：
    - 履历客观度: [X/5] — [理由]
    - 关系并置度: [X/5] — [理由]
    - 文字底色: [X/5] — [理由]
edge_cases: [需要处理的边界问题]
affected_scope: [涉及的关系段/层级清单]
execution_plan:
  - step_1: [具体写法方案]
  - step_N: [...]
degradation_check:
  - 履历是否混入了态度/职业/性格词？ → [YES/NO + 列出]
  - 关系段的独白是否在解释公开的动机？ → [YES/NO + 具体位置]
  - 关系段的经历是否带因果指向？ → [YES/NO + 具体位置]
  - 句式是否写了功能解释或画面评价？ → [YES/NO + 具体位置]
  - 他者评价是否出现了关系段角色名？ → [YES/NO + 列出]
  - 作者笔记是否指向具体台词？ → [YES/NO]
  - 作者笔记是否包含可检验的待解问题？ → [YES/NO]
  - 作者笔记是否可转移到另一角色？ → [YES/NO]
  - 是否因某个关系段难写而打算简化？ → [YES/NO + 理由]
  - 是否有被判断为"无关紧要"而跳过的失守？ → [YES/NO + 理由]
  - 关系：自己的独白是否与角色自述重叠？ → [YES/NO + 具体位置]
  - 独白中是否出现假独白或角色替自己下结论？ → [YES/NO + 具体位置]
  - 亲密场景是否承担关系动作而非纯描写？ → [YES/NO]
  - 是否在人设语境使用了否定清单定义人物？ → [YES/NO + 理由]
</analysis>
```

执行阶段连续超过 5 个工具调用时，必须重新读取 `.yokenken-analysis-cache.md` 刷新记忆。

---

## 阶段三：执行

分析完成后，严格按 execution_plan 逐条写。

遇到意外时输出 `<decision_point>` 块：

```
<decision_point>
issue: [遇到了什么意外]
impact: [对交付物的影响]
context_update: [新发现的事实]
options:
  option_a: [方案描述 + 三维评估 + 边界]
  option_b: [方案描述 + 三维评估 + 边界]
  option_c: [方案描述 + 三维评估 + 边界]
recommendation: [选择 + 理由]
execution_plan_update: [更新后的计划]
deviation_audit: [偏差审查]
degradation_check: [重新检查]
</decision_point>
```

- options 至少三个方案
- recommendation 必须选择三维评估综合最优
- 输出前刷新措辞替换规则（读取 yokenken-style 的 phrase-rules.md）
- 输出后追加写入 `.yokenken-analysis-cache.md`

---

## 阶段四：验收

执行全部完成后，先读取 `.yokenken-analysis-cache.md` 刷新记忆，然后输出 `<output_quality_review>` 块：

```
<output_quality_review>
task_summary: [任务摘要]
deliverables: [交付物清单]
metrics:
  total_sections: [关系段数量]
  biography_clean: [履历是否纯客观]
  relation_contradiction_count: [三层矛盾数量]
  author_note_verified: [作者笔记是否通过三条验收]

biography_check:
  - 姓名是否纯名？ → [YES/NO]
  - 年龄是否纯数字？ → [YES/NO]
  - 显著特征是否名词短语无修饰？ → [YES/NO]
  - 日常穿着是否名词短语无频率词？ → [YES/NO]
  - 嗜好习惯是否无动机词？ → [YES/NO]
  - 家庭关系是否XX=姓名格式？ → [YES/NO]
  - 是否混入职业/社会角色？ → [YES/NO]
  - 是否有不确定词？ → [YES/NO]
  - 是否有性格形容词？ → [YES/NO]

relation_check:
  - 每个关系段是否包含经历、句式、公开、独白四层？ → [YES/NO]
  - 句式是否只写可观测特征？ → [YES/NO]
  - 经历是否无文学修饰和因果指向？ → [YES/NO]
  - 独白是否未解释公开动机？ → [YES/NO]
  - 笼统对象段是否在具体关系段之前？ → [YES/NO]
  - 关系段之间是否无递进/过渡/总结？ → [YES/NO]
  - 关系：自己段是否包含经历、句式、公开、独白四层？ → [YES/NO]
  - 关系：自己的独白是否与角色自述信息重叠？ → [YES/NO]
  - 关系：自己的独白是否遵守假独白禁令？ → [YES/NO]
  - 独白中是否出现假独白（角色用旁白方式描述自己的动作）？ → [YES/NO]
  - 独白中是否出现角色替自己下结论？ → [YES/NO]

hearsay_check:
  - 评价者是否不出现在关系段标题中？ → [YES/NO]
  - 是否至少两种视角？ → [YES/NO]
  - 是否有"没想通"的钩子？ → [YES/NO]
  - 是否无介绍式标签？ → [YES/NO]

calibration_check: [仅进阶版]
  - 是否包在<if>块内？ → [YES/NO]
  - 是否含不确定词？ → [YES/NO]
  - 是否1-3句？ → [YES/NO]
  - 是否未泄漏变量值？ → [YES/NO]

intimate_scene_check: [如有亲密场景]
  - 亲密场景是否位于他者评价之后？ → [YES/NO]
  - 亲密场景触发方式是否明确（<if>条件 或 KEY）？ → [YES/NO]
  - 亲密场景语料是否承担关系动作而非纯描写？ → [YES/NO]
  - 亲密场景中是否遵守假独白禁令？ → [YES/NO]

author_note_check:
  - 是否指向具体台词？ → [YES/NO + 哪句]
  - 是否包含可检验的待解问题？ → [YES/NO + 什么问题]
  - 是否不可转移？ → [YES/NO + 验证过程]
  - 职业信息（如有）是否绑在刻板印象纠正过程中？ → [YES/NO]

needs_alignment:
  - 满足用户本质需求？ → [YES/NO]
  - 如果这是别人交给我的，我会接受吗？ → [YES/NO + 理由]
</output_quality_review>
```

验收发现问题必须就地修正，修正后重新验收。

验收通过后：缓存追加验收报告 → 创建归档目录 → 移动缓存为归档文件。

---

## 危险信号自检表

命中以下任一项不能交付：
- 履历含态度/职业/不确定词/进入<if>块
- 独白解释公开动机
- 经历带因果指向
- 他者评价出现关系段角色名
- 作者笔记不指向具体台词
- 作者笔记无可检验待解问题
- 作者笔记可转移到另一角色
- 关系段互相解释或递进
- 否定动作清单堆砌定义人物
- 独白中角色用旁白方式描述自己的动作（假独白）
- 独白中角色替自己下结论
- 出现网络爆词/自媒体腔/文白混杂/儿化音