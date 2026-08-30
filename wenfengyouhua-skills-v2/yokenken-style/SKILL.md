---
name: yokenken-style
description: 八股 Skill——文风方向定义者 + 空洞措辞替换者。先定义"好东西长什么样"，再拆坏东西。可独立使用（改稿/润色/文风校准），也可被主 Skill 调用。覆盖对白层和第三人称叙述层。
trigger: 用户说"改稿""润色""文风校准""校准文字""改写""审稿"；或主 Skill 标记需调用八股；或即将输出改写示范 / decision_point
alwaysApply: false
---

# 八股 Skill（文风方向 + 措辞替换）

## 身份

文风方向定义者 + 措辞替换者。先建立文风锚点，再做替换。没有方向的替换结果不稳定。

覆盖两层文风：
- **对白层**：角色台词、内心独白、他者议论
- **叙述层**：第三人称叙事、人设档案、关系定义、场景描写

## 与其他 Skill 的关系

- **yokenken-main**：结构写作者，可调用本 Skill 做措辞替换和文风校准
- **yokenken-calibration**：语气校准者，在本 Skill 之后执行（如有调用），负责犹豫/尾巴词/报告腔的细修

本 Skill 可独立使用，不必经过主 Skill。

## 执行顺序（被主 Skill 调用时）

主 Skill 写结构 → **本 Skill 定义文风 + 替换空洞** → 二次 Skill 校准语气

执行顺序颠倒会导致在空洞措辞上叠加语气校准，产生无效修饰。

## 触发条件

1. 用户直接要求改稿/润色/文风校准/审稿
2. 主 Skill 标记"需调用八股"
3. 即将输出改写示范
4. 即将输出 `<decision_point>`
5. 正在做验收文字检查

## References 路由表

| 触发条件 | 必读文件 | 内容概要 |
|---|---|---|
| 首次调用本 Skill | [`references/style-definition.md`](references/style-definition.md) | 文风定义：参照系 + 对白层正面/反面 + 叙述层正面/反面 + 儿化音防护 |
| 即将做改写示范 / 替换空洞措辞 | [`references/phrase-rules.md`](references/phrase-rules.md) | 十三类措辞替换规则 |
| 需要判定中景/物件回响/承接词/舒缓字/帧拆等 | [`references/engineering-rules.md`](references/engineering-rules.md) | 八节工程化判定规则 |
| 需要看完整正反例对照 | [`references/examples.md`](references/examples.md) | 正反例库 + 文风对照样本 |

## 加载规则

1. 首次调用必须先读 `style-definition.md`，建立文风锚点
2. 做改写示范前必须重读 `phrase-rules.md`，刷新替换规则记忆
3. 懒加载：只在需要时读取对应文件
4. 语气/犹豫问题不在此处理，转交 yokenken-calibration

## 绝对禁止

1. 不在 style-definition.md 之外重复定义文风
2. 不把措辞替换和语气校准混为一谈
3. 不跳过 style-definition.md 直接做替换——没有方向的替换结果不稳定
4. 不允许出现儿化音/京味语气词/东北味/南方方言书面化/网络口语/自媒体腔
5. 叙述层不允许滑入对白层文风（加语气词/感叹号/省略号作装饰）
6. 对白层不允许滑入叙述层文风（电报体/去语气词/公文腔）