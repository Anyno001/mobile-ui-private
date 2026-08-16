# 今日风向标题关键词 SVG 映射设计

## 1. 目标

为今日风向的两个展示模块建立统一的、纯运行时的 SVG 映射能力：

- **世界态势**：根据 `scope.world.items[].name` 选择信号节点 SVG；未命中使用世界态势默认图标。
- **事件追踪**：根据 `event.title` 选择事件节点 SVG；未命中保留既有 `event.type` 图标兜底，再退回普通事件图标。

映射必须是代码中的固定规则表，且同一标题在两个模块中得到相同的语义图标。它只改变展示层，不得改变世界态势、事件、生成结果或任何持久化内容。

## 2. 已确认现状

| 范围 | 已有实现 | 问题 |
| --- | --- | --- |
| 世界态势 | `src/today-trend-world-view.js` 对所有项目渲染固定 `<i>` 圆点 marker | 标题没有语义图标能力 |
| 事件追踪 | `src/today-trend-dynamics-view.js` 内部 `EVENT_ICONS` 与 `eventIcon(event)` 已按少量标题关键词匹配 | 规则局部、词表狭窄、无法复用到世界态势 |
| 图标库 | `src/icons.js` 集中维护通用、日历、天气、社区、今日风向模块图标 | 并非每一个操作 SVG 都适合内容语义映射 |
| CSS | 世界与事件 marker 均已有稳定尺寸、主题色、`aria-hidden` 和 SVG 尺寸规则 | 可在不新增视觉 token 的前提下承载 SVG |

当前事件追踪匹配仅覆盖地点、信号、传闻和文档，未命中时按 `event.type` 回退。设计保留这一回退语义，但把规则提炼为公共解析器。

## 3. 边界与非目标

### 包含

- 仅处理世界态势 `item.name` 与事件追踪 `event.title`。
- 使用既有 `src/icons.js` 中语义适配的 SVG，必要时将当前事件追踪局部 SVG 提升进该集中图标库。
- 固定优先级、固定关键词、默认兜底、自动契约测试。

### 不包含

- **不**向 `world.items`、事件、preset、scope 或 storage 写入 `icon` / `iconKey` 字段。
- **不**修改 `TODAY_TREND_VERSION`、schema、备份、导入导出、分支继承或生成 prompt。
- **不**扫描摘要、起因、阶段记录、参与者、聊天正文或世界书正文。
- **不**新增用户自定义关键词设置、动态正则配置、AI 分类或第三方依赖。
- **不**强行给 `EDIT_ICON_SVG`、`TRASH_ICON_SVG`、`SEND_ICON_SVG` 等操作图标寻找标题语义；这不是完整映射，而是把操作控件误画进内容模型。

## 4. 架构

新增纯展示模块：`src/today-trend-title-icon-mapping.js`。

```mermaid
flowchart LR
  W[world.items[].name] --> R[resolveTodayTrendTitleIcon]
  E[dynamics event.title] --> R
  R --> K[固定优先级关键词规则表]
  K -->|命中| I[固定 SVG catalog key]
  K -->|世界态势未命中| WD[TODAY_TREND_WORLD_ICON_SVG]
  K -->|事件未命中| EF[event.type fallback]
  EF --> ED[普通事件默认 SVG]
  I --> V[world / dynamics view marker]
  WD --> V
  ED --> V
```

### 4.1 模块职责

| 模块 | 职责 |
| --- | --- |
| `src/icons.js` | SVG 字符串的唯一集中所有者；保留已有通用图标，必要时接收从 dynamics view 提升的事件专用 SVG。 |
| `src/today-trend-title-icon-mapping.js` | 标题标准化、不可变规则表、优先级匹配、世界/事件默认兜底、返回 `{ key, svg }`。不读取 store，不写状态。 |
| `src/today-trend-world-view.js` | 调用世界解析入口，输出带 SVG 的装饰性 marker。 |
| `src/today-trend-dynamics-view.js` | 删除局部 `EVENT_ICONS`/`eventIcon`，调用事件解析入口；保留 `event.type` badge、归档和操作逻辑。 |
| `scripts/check-today-trend.mjs` | 锁定映射、冲突优先级、默认回退、标题唯一输入和 marker DOM 契约。 |
| `scripts/check-contracts.mjs` | 锁定世界 marker 与事件 marker 的 SVG 尺寸/主题语义，防止回退为裸圆点或新增未登记视觉硬编码。 |

## 5. 映射契约

### 5.1 输入标准化

解析器只接受字符串标题：

1. `String(title || '')`；
2. `normalize('NFKC')`，统一全角符号/数字；
3. trim、折叠空白；
4. 英文部分转小写；
5. 仅对固定的源码正则表执行 `test()`。

不使用用户提供的正则，不动态编译配置；因此不存在正则注入或持久化配置兼容问题。

### 5.2 优先级

标题可能同时包含多个类别。匹配按以下顺序，**首个命中即返回**：

| 优先级 | 映射 key | 示例关键词（固定、可审计） | SVG 语义 |
| ---: | --- | --- | --- |
| 1 | `weather-storm` | 雷暴、暴雨、台风、飓风、洪水、山火、地震、灾害 | 强天气/灾害 |
| 2 | `document` | 公告、通告、签署、协议、条约、法令、政策、通知 | 正式文本/决定 |
| 3 | `rumor` | 传闻、流言、谣言、爆料、辟谣 | 传播性信息 |
| 4 | `signal` | 联络、通讯、信号、对接、协作、会谈 | 连接/协同 |
| 5 | `calendar` | 日程、期限、会议、峰会、纪念、周年、倒计时 | 时间节点/安排 |
| 6 | `live` | 直播、演出、开幕、发布会、展演、活动 | 公开活动 |
| 7 | `heart` | 恋情、恋爱、婚礼、分手、和解、告白 | 社会/情感关系 |
| 8 | `location` | 航线、路线、港口、机场、车站、城市、城区、区域、地点、迁移 | 地理/移动 |
| 9 | `weather` | 天气、降温、高温、酷暑、寒潮、降雪、雾、云 | 一般气象 |
| 10 | `trend` | 增长、下滑、复苏、转型、扩张、收缩、走势、趋势 | 发展变化 |
| 11 | `sparkles` | 发现、突破、研发、实验、新品、异象 | 新发现/突破 |
| 12 | `recipe` | 餐饮、美食、食谱、餐厅、菜单 | 饮食生活 |
| 13 | `outfit` | 时装、服饰、穿搭、造型、秀场 | 服饰生活 |
| 14 | `time` | 历史、旧案、溯源、年代、回顾 | 时间溯源 |

规则表中的短词必须谨慎：禁止把单字 `港`、`城`、`信` 等宽泛字符作为关键词。它们会让中文标题出现大量误命中，属于看似聪明、实则不稳定的设计。

### 5.3 冲突示例

| 标题 | 结果 | 原因 |
| --- | --- | --- |
| `暴雨侵袭港口航线` | `weather-storm` | 灾害优先于地点 |
| `港口签署通航协议` | `document` | 正式决定优先于地点 |
| `城市辟谣发布会` | `rumor` | 传播性信息优先于公开活动与地点 |
| `机场联络窗口开放` | `signal` | 通讯协同优先于地点 |
| `新区发展趋势报告` | `document` | 报告/公告类正式文本优先；若不含正式文本关键词才为 `trend` |

优先级是产品契约，不允许以后通过在视图内追加一个随意 `if` 悄悄改变。新增关键词必须进入同一规则表，并补冲突测试。

### 5.4 兜底

```text
世界态势：标题未命中 → world-default
事件追踪：标题未命中 → type 对应 SVG → event-normal
```

事件 type 回退保持语义：

| type | fallback key |
| --- | --- |
| `incident` | `event-incident` |
| `rumor` | `rumor` |
| `underground` | `event-underground` |
| `normal` 或未知 | `event-normal` |

标题命中优先于 type。这是用户明确要求的“标题关键词切换图标”；type 仍通过现有 badge 展示，不需要把视觉判断混成另一套状态机。

## 6. SVG catalog 决策

复用适合内容语义的现有图标：`TODAY_TREND_WORLD_ICON_SVG`、`LOCATION_ICON_SVG`、天气图标、`CALENDAR_ICON_SVG`、`CHAT_ICON_SVG`、`LIVE_ICON_SVG`、`HEART_ICON_SVG`、`TREND_ICON_SVG`、`SPARKLES_ICON_SVG`、`RECIPE_ICON_SVG`、`OUTFIT_ICON_SVG`、`TIME_ORIGIN_ICON_SVG`。

当前 dynamics view 中的 `location/signal/rumor/document/incident/normal/underground` SVG 需要迁入 `src/icons.js`，成为集中、可复用的内容图标常量。迁移时保持 SVG path 不变，避免关键词系统顺手重做既有事件视觉。

`world-default` 采用 `TODAY_TREND_WORLD_ICON_SVG`；事件普通兜底保持当前 `normal` 的加号圆 SVG。这样世界态势和事件追踪默认图标不同，仍能区分模块职责。

## 7. 视图与 CSS

### 世界态势

将固定的：

```html
<span class="pm-today-trend-world-signal-marker" aria-hidden="true"><i></i></span>
```

替换为解析器输出的 SVG，并在 marker 上提供稳定、纯展示的 `data-today-trend-icon` key，便于契约测试和故障定位：

```html
<span class="pm-today-trend-world-signal-marker" data-today-trend-icon="location" aria-hidden="true">…svg…</span>
```

### 事件追踪

保留 `.pm-today-trend-event-marker`、`data-event-type`、type badge、操作按钮、`aria-hidden="true"`。仅将内层 SVG 来源改为同一解析器。

### 样式

- 世界 marker 取消仅用于 `<i>` 内核的样式，新增/复用 marker SVG 尺寸规则，消费已有 `--pm-size-icon-md`。
- 事件 marker 已有 SVG 尺寸规则，维持不变。
- 两类 marker 继续使用 `background:var(--pm-color-accent)` 与 `color:var(--pm-color-on-accent)`；SVG 使用 `currentColor`。
- 不引入按关键词区分的颜色、裸尺寸、动画、`!important` 或额外主题 token。

## 8. 测试与验收

### 自动契约

在 `scripts/check-today-trend.mjs` 增加：

1. 世界态势：地点、天气灾害、公告、默认标题分别匹配预期 `data-today-trend-icon`；不再要求 `<i>`。
2. 事件追踪：标题命中优先于 type；`incident` 标题命中地点时显示地点 SVG，但仍保留突发 badge。
3. 同一标题在世界/事件两种视图返回相同 mapping key。
4. 冲突优先级：`暴雨港口`、`港口签署协议`、`城市辟谣发布会`。
5. 标题空、未知标题、全角输入都走正确默认/类型回退。
6. 摘要、origin、latestStage、participants 中出现关键词不得改变图标。
7. marker 必须继续 `aria-hidden="true"`；标题文字仍在 `<b>` 中，不能用图标替代文本。

在 `scripts/check-contracts.mjs`：

1. 世界 marker 与事件 marker 的 SVG 必须使用既有尺寸 token；
2. 世界 marker 不得重新出现仅 `<i>` 的结构；
3. 不得出现未登记的颜色、裸尺寸、动画时长或无注册 `!important`。

### 验证顺序

1. `npm.cmd run build`
2. `npm.cmd run check:syntax`
3. `npm.cmd run check:today-trend`
4. `npm.cmd run check:contracts`
5. `npm.cmd run check`
6. `git diff --check`

### 人工回归

在真实 SillyTavern 宿主确认：

- 亮色、暗色与自定义主题下 SVG 对比度；
- 世界态势首项和后续信号项均正常对齐；
- active/archived 事件 icon、badge、时间线与操作菜单不回归；
- 长标题换行、窄屏、loading/disabled 状态不挤压 marker；
- 标题编辑保存后无需迁移，下一次 rerender 自动更新 SVG。

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 中文 substring 误命中 | 禁止过宽单字；固定词组；冲突测试；只匹配 title |
| 新规则悄悄改变旧事件图标 | 迁移现有 events 的 SVG path 并为原四组关键词加回归测试 |
| 映射系统侵入模型/生成 | 解析器只返回展示 `{ key, svg }`，没有 store 写入或 prompt 输入 |
| 图标替代文字造成无障碍退化 | marker `aria-hidden`，标题 `<b>` 保持唯一文本语义 |
| 规则膨胀 | 仅添加跨世界态势和事件追踪均有稳定语义的类别；单次特例先审查，不建用户配置 |
| 视觉 token 漂移 | 复用现有 marker 尺寸与 accent/on-accent；不按图标类别着色 |

## 10. 回滚

功能无持久化影响，回滚仅涉及：

1. 删除/回退 `today-trend-title-icon-mapping.js`；
2. 恢复世界态势固定 marker 和事件追踪局部 icon resolver；
3. 回退 `icons.js` 提升出的常量、视图调用和对应测试/CSS。

回滚不会影响历史世界态势、事件数据、备份或分支状态。
