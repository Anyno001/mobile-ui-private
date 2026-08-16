<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/today-trend-icon-coverage-convergence.md","contentHash":"sha256:1934cf754eb118e529a653ea61a2715929d4411a4bdadd6e0df0bb81d35eeebe"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 调用独立验收专家复核，清理临时产物，提交并推送 main，核对远端与同步计划/进度  `#today-trend-icon-acceptance-delivery`
- [x] 补充行为契约：20 类正例、天气矩阵、冲突/自然样本、隔离、fallback、完整性与 parser 负例  `#today-trend-icon-contracts`
- [x] 冻结专项基线：核对 HEAD/origin/工作树、精读相关实现与契约，确认持久化边界、依赖与真实宿主样本状态  `#today-trend-icon-coverage-baseline`
- [x] 按 world/active/archived 进行真实宿主 key-only 采样；无可信结果不虚构百分比  `#today-trend-icon-host-sampling`
- [x] 将共享命名指南注入初始化与增量 prompt，保持 schema 与 parser 边界不变  `#today-trend-icon-prompts`
- [x] 改造标题图标 resolver 消费共享目录，扩充既有 SVG 映射并保持 API/fallback 兼容  `#today-trend-icon-resolver`
- [x] 复核 marker CSS/inline/runtime 静态契约，仅按实际新增不变量更新  `#today-trend-icon-static-contracts`
- [x] 新增共享标题语义目录：20 个有序 topic、命名指南与静态匹配规则  `#today-trend-icon-topic-catalog`
- [x] 单独执行 build、syntax、today-trend、contracts、全量检查与 diff-check 并定位失败归属  `#today-trend-icon-validation`
<!-- LIMCODE_TODO_LIST_END -->

# 今日风向图标覆盖率收敛实施计划

## 1. 计划来源与目标边界

- **已确认设计**：`.limcode/design/today-trend-icon-coverage-convergence.md`
- **目标**：将固定标题语义目录同时用作生成提示词的命名引导和展示 resolver 的唯一匹配来源；复用现有 SVG，将当前 14 类标题命中扩展为 20 类有序 topic，并细分天气。
- **交付定义**：新生成内容在事实适配时更可能产生可映射标题；既有存储内容在重新渲染时获得更细图标；未知内容仍有可预测 fallback。不是借题引入持久化 icon 分类系统。

### 明确不做

- 不改 `TODAY_TREND_VERSION`、scope/model/schema、store、备份、导入导出、分支复制、generation snapshot 或 AI 返回 JSON 结构。
- 不给 `world.items[]` 或 event 写入 `icon` / `iconKey` / `topic` / `category`。
- 不修改 world/dynamics view 的调用 API、marker DOM、CSS token、颜色语义或无障碍策略，除非精确侦察发现既有结构无法承载新 key；预计不需要此类变化。
- 不引入动态正则、用户可编辑映射、第三方图标依赖或采集标题/聊天文本的遥测。
- 不把 12 个 faction/reputation 分层背景 SVG 冒充 24×24 内容图标。

## 2. 已确认现状与关键问题

| 链路 | 已证实行为 | 缺口 |
|---|---|---|
| SVG catalog | `src/icons.js` 有 64 个完整 SVG 常量，含细分 weather（晴/少云/云/雾/雪/雷暴）与 community 图标 | title resolver 仅消费 18 个结果 key，细分 weather 未被使用 |
| 标题解析 | `src/today-trend-title-icon-mapping.js` 以 14 条局部规则首个命中，并在无命中时 world→默认、event→type fallback | 规则与 prompt 没有共同来源，现实标题未必包含锚词 |
| 生成 | `src/prompts/today-trend/envelopes.js` 只约束 `name/title` 字段结构 | AI 没有被告知何时使用可映射且自然的标题语义 |
| 视图 | world 仅把 `item.name` 交给 resolver；event 只把 `event.title/type` 交给 resolver | 正确，应保持；不得改为扫描 summary/origin/stage |
| 历史数据 | 标题已持久化但 icon 未持久化 | 无迁移需求；重渲染即可应用新规则 |

## 3. 实施顺序、依赖与回滚点

```text
A 基线/隔离
  └─> B 共享 topic 目录 ─> C resolver/catalog ─┬─> E 行为契约 ─> G 验证
                                                └─> D prompt envelopes ─┘
G 自动门禁 ─> H 宿主 key-only 采样 ─> I 独立验收与发布
```

- B 是 C 与 D 的唯一前置。禁止 resolver 和 envelope 分别保留平行关键词列表。
- C 与 D 可在 B 后并行实施，但合并前必须共同锁定 topic 导出与 prompt guide 格式。
- E 需要等待 B/C/D 的公开 API 与关键措辞稳定。静态 CSS 契约复核可与 E 并行，但不应无理由修改 CSS。
- G、H、I 严格串行；自动门禁与独立验收不可由“看起来合理”取代。

回滚点：

- **R1**：回退 B/C/D 和对应测试，旧视图与数据不受影响。
- **R2**：若生成标题措辞不自然，仅回退 prompt guide 注入，保留已经验证的纯展示细分映射。
- **R3**：若某个新增 topic 误命中，回退该目录条目及其精确测试；不得通过扩大 fallback 或删除测试伪造稳定。

## 4. 分阶段任务

### A. 冻结基线、范围与调用方

1. 在新分支状态记录 `HEAD`、`origin/main`、`git status --short` 与本专项目标文件 diff；若存在未归属改动，先停止并确认，禁止把先前发布收尾文件或他人变更混进专项。
2. 精读并搜索：
   - `src/icons.js` 的常量及既有同形、不同 `stroke-width` 图标；
   - `src/today-trend-title-icon-mapping.js` 的 public resolver、fallback 与 import 链；
   - `src/prompts/today-trend/envelopes.js` 的初始化/增量 systemPrompt 和 userPrompt；
   - `src/today-trend-world-view.js`、`src/today-trend-dynamics-view.js` 的唯一调用点；
   - `scripts/check-today-trend.mjs` 与 `scripts/check-contracts.mjs` 的现有契约；
   - `AGENTS.md`、`docs/CSS-TOKENS.md`、`docs/BASELINE.md`，即使预计不改样式也要确认 SVG/CSS 边界。
3. 搜索导入者，确保新增 shared topic module 不产生循环依赖：topics 不能导入 mapping、icons、views 或 prompts；mapping/prompts 均只能单向导入 topics。
4. 搜索可访问的 repository fixture/真实宿主导出；若没有真实持久化样本，记录“无法量化历史默认率”，不编造覆盖数字。

**验收**：形成 `topic module → mapping / envelopes → views → tests` 依赖表；工作树干净或每处已有改动归属明确；确认 views 只使用 name/title/type。

### B. 建立共享语义目录

新增 `src/today-trend-title-icon-topics.js`，并严格保持纯数据属性：

1. 定义一个 `Object.freeze` 的有序 topic 数组，共 20 项，顺序与设计 §5 一致：
   - weather-storm、weather-snow、weather-fog、weather-sun、weather-partly-cloudy、weather-cloud；
   - document、rumor、signal、calendar、live、heart、location、community、weather、trend、sparkles、recipe、outfit、time。
2. 每项包括：稳定 `key`、中文 `label`、冻结 `promptTerms`、静态 `pattern`。运行时不得由用户文本、配置或 `new RegExp` 构造 pattern。
3. `pattern` 只覆盖设计批准的多字短语或明确领域词；禁止 `港`、`城`、`信`、`服务` 等宽泛单字。`雾`不单独恢复为旧规则，而应只按“大雾/浓雾/雾霾”进入细分雾；普通“雾”是否继续属于泛天气必须通过明确决策与测试，不得悄悄扩大误命中面。
4. 导出最小 API：
   - resolver 读取的只读 `TODAY_TREND_TITLE_ICON_TOPICS`；
   - envelope 使用的 `todayTrendTitleNamingGuide()`，由 topics 的 `label/promptTerms` 格式化生成。
5. naming guide 是面向模型的中文指导，不暴露 RegExp、SVG、内部 fallback key 或 JSON schema 外的“分类字段”指令；它必须包含“仅事实适配时使用锚词、不可为图标硬塞、未分类可自然命名、不得输出 icon/iconKey/category”。

**验收**：模块在 node import 下无副作用；每条 key 唯一；prompt guide 不含 `<svg`、正则字面量或 fallback key；目录顺序稳定且可直接由测试枚举。

### C. 重构 resolver 和 SVG catalog

1. 在 `src/today-trend-title-icon-mapping.js` 删除局部 `TITLE_ICON_RULES` 的所有权，改由 B 的有序 topics 进行首个 `pattern.test(normalizedTitle)`。
2. 保留 `normalizeTitle` 的 NFKC、trim、空白折叠、小写顺序及无输入对象修改行为。
3. 扩展 catalog，使 20 个 topic key 全部有 SVG：
   - 新增 weather-snow/fog/sun/partly-cloudy/cloud，对应既有 `WEATHER_*_ICON_SVG`；
   - 新增 community，对应 `COMMUNITY_ICON_SVG`；
   - recipe 等继续引用既有公共内容 SVG；
   - 绝不重画或替换已有 event 专属 1.8 线宽 SVG。
4. 保持现有 fallback 契约：标题命中优先；event 未命中仅按 incident/rumor/underground/normal 决定 fallback；world 未命中始终 `world-default`。
5. 将 catalog 完整性变为显式不变量：**所有 topic key 必须存在于 SVG catalog；fallback key 可额外存在，但不能伪装成 topic**。这比设计中“所有 key 集完全相等”的简写更准确，避免将 world/event fallback 错判为孤儿。
6. 不改变 `resolveTodayTrendTitleIcon` 入参、返回 `{ key, svg }`、world/dynamics call sites 或 `data-today-trend-icon` 格式。

**验收**：20 个 topic 得到非空、`stroke="currentColor"` 的 SVG；相同命中标题跨 world/event 得到同一结果；world/event 旧 fallback 不变；没有平行 if/regex 留在 views。

### D. 将同源命名指南接入生成 envelope

1. 在 `src/prompts/today-trend/envelopes.js` 导入 naming guide helper；不从 mapping 导入，防止 prompt 模块依赖 SVG catalog。
2. 初始化 envelope 的 `systemPrompt` 追加固定命名说明，覆盖 `world.items[].name` 与事件 `title`，但不修改任何字段清单、版本、上限、type、lifecycle 或 JSON top-level 约束。
3. 增量 envelope 使用同一 helper 和相同核心承诺；其位置应在 schema 约束之后、用户数据之前，确保 untrusted data 不能覆盖它。
4. 文案必须明确：
   - 仅事实适配时标题可使用目录中的一个自然锚词；
   - 不能为了图标重命名或虚构事实；
   - 未分类主题允许保持自然标题；
   - 禁止输出 icon/iconKey/topic/category 等额外字段。
5. 确认更新逻辑仍保护 archived 的字段原样保留、active 的 type 和基础资料不被图标需求改写；这属于已有 `generation.js` 边界，不能被 prompt 文字绕开。

**验收**：两个 envelope 均含同一 guide 生成片段；guide 只随 topics 改动，不形成手写重复词表；AI 输出验证器仍拒绝 schema 外字段。

### E. 行为与生成契约

在 `scripts/check-today-trend.mjs` 增加精确断言，不扩大 fixture 到无关模块：

1. 对 20 个 topic 各设一个自然标题正例，并确认 key 与 SVG 存在。
2. 细分天气矩阵：
   - 暴雪→weather-snow；大雾→weather-fog；晴天/热浪→weather-sun；多云→weather-partly-cloudy；阴云→weather-cloud；寒潮→weather；
   - 暴雨/灾害与天气/地点复合标题仍优先 weather-storm。
3. 锁定原冲突：暴雨+航线、协议+港口、辟谣+发布会、联络+机场、趋势+报告；`报告→document` 不得回退。
4. 固定侦察已发现的自然 fixture：节目风向→trend、后勤消息→signal、观众情绪→community、晚餐服务/后厨协调→recipe；保留一个真正未知标题用于 world-default 与 event-normal/type fallback。
5. 验证标题命中仍优先于 event type，badge 仍按 type 渲染；summary/origin/latestStage/participants 单独出现新增 topic 词时不影响 icon。
6. 检查 topics、SVG catalog 与 naming guide：
   - topic key 无重复；
   - 每个 topic 都映射 SVG；
   - guide 从 topic 导出生成且不含 SVG/正则/iconKey/category；
   - 初始化与增量 envelopes 同时含 guide 的稳定片段，并继续明确 JSON 输出边界。
7. 构造包含 `icon` / `iconKey` / `category` 的 AI JSON，确认现有严格解析仍拒绝；此项应复用现有 generation parser 的 fixtures，不建立虚假并行校验器。

**验收**：故意删掉一个 topic SVG、改换 priority、在非标题字段塞关键词、或删除任一 prompt guide 注入时，专项检查产生确定失败。

### F. 静态/CSS 契约复核

1. 搜索世界/事件 marker 的所有 CSS、inline style 与 runtime style 写入。预期无需改 CSS：新图标仍进入现有 SVG marker，继续消费已有尺寸 token。
2. 仅当本专项引入新的、可静态检测的源代码不变量时才更新 `scripts/check-contracts.mjs`，例如 topic module 禁止导入 UI/store 或 mapping 继续使用公共 resolver。不要将运行行为复制进错误的静态检查层。
3. 不刷新 CSS governance registry；如果它失败，必须定位实际 fingerprint/legacy 值来源，不能把 registry 当橡皮擦。
4. 确认 `currentColor`、`aria-hidden="true"`、`data-today-trend-icon` 结构与世界 marker 禁止 `<i>` 的既有契约仍通过。

**验收**：无裸 CSS 值、无新增 token、无 SVG 色彩例外、无 DOM 结构退化；静态契约只增加真实可验证边界。

### G. 自动验证与 diff 审查

在 Windows 环境中逐条使用 PowerShell 与 `npm.cmd`，不使用 cmd 的 `&&`：

1. `npm.cmd run build`
2. `npm.cmd run check:syntax`
3. `npm.cmd run check:today-trend`
4. `npm.cmd run check:contracts`
5. `npm.cmd run check`
6. `git diff --check`

同时审查：

- `git diff --stat` 与逐文件 diff；
- `index.js` 仅由 build 更新；
- 未触碰 model/store/schema/version/backup/依赖/lockfile；
- 没有临时 runner、日志、截图、采样导出、`.limcode/tmp-*` 或 review 文件遗留；
- 任何命令失败先判定实现/断言/构建/环境归属，禁止对同一个错误命令无限重试。

**验收**：所有命令 exit 0；既有预期测试噪音若存在，必须以命令成功退出和既有断言语义证明，而不能被误述为失败。

### H. 真实宿主 key-only 采样与视觉/辅助技术回归

在真实 SillyTavern 宿主中，分别打开世界态势、活动事件、归档事件，使用 DOM 的 `data-today-trend-icon` 仅聚合 key 计数：

```js
[...document.querySelectorAll('[data-today-trend-icon]')]
  .reduce((counts, node) => {
    const key = node.dataset.todayTrendIcon;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
```

记录范围、采样时间和 key 计数；不得复制标题、对话正文、角色资料或备份数据进日志。检查：

- world-default 与 event-normal 的数量及占比；
- 新 weather/community/trend/recipe/signal key 是否实际渲染；
- 亮色、暗色、自定义主题、窄屏、长标题、world hero/brief、event active/archived、读屏/Accessibility Tree；
- marker 与 badge/菜单之间没有视觉、焦点或语义冲突。

**验收**：提供最小化、无内容泄漏的 key-only 采样证据。没有原始基线时只报告当前分布，不虚构“提升 X%”。无法访问宿主时必须作为 explicit minor/阻塞项传给验收和助手。

### I. 独立验收与发布

1. 备齐 design/plan 路径、关键源码片段、自动门禁 exit 0、diff/stat、临时产物清理和宿主采样状态。
2. 调用独立 Acceptance Expert。存在 blocking/major 时，修复后复验，最多 8 轮；未 PASSED 前不关闭验收 TODO。
3. 提交前执行 `git diff --cached --check`、敏感/临时文件扫描和工作树核对。发布/推送只在助手明确授权且剩余宿主风险被接受时进行。
4. 推送后核对 `HEAD == origin/main`、远端 ref 与工作树干净；同步计划/progress/TODO。

**验收**：blocking=0、major=0；任何未执行的真实宿主采样或视觉/辅助技术回归如实列为 minor 或阻塞，不允许把自动测试伪装成宿主验证。

## 5. 风险控制与计划自审

| 风险 | 控制措施 |
|---|---|
| 词表扩张造成误分类 | 限定设计批准的领域词与多字锚词；新增项必须配正/负例与冲突优先级断言。 |
| prompt 与 resolver 再次漂移 | topics 单一来源；resolver 与 guide 各从同一模块读取；测试锁 topic→SVG、topic→guide。 |
| 因 prompt 改动碰坏 JSON 协议 | 保持 schema 文本与 parser 不变；用额外字段拒绝用例证明防线仍在。 |
| 存储兼容事故 | 不写字段、不迁移、不回填；历史标题仅在 render 时重算。 |
| 细分 SVG 视觉弱区分 | 保持 existing `currentColor` 和 token；强制真实宿主主题/窄屏验证。 |
| 默认仍高 | 采集 key-only 分布和真实未命中类别后再决策，不能以宽泛词误匹配换“多样性”。 |
| 跨模块范围失控 | 限定为 topic/mapping/prompts/tests/build；view、model、store、CSS 仅审查，不作为默认改动目标。 |

这份计划能执行，但我刻意收紧了设计中的一个表述：topic、SVG catalog 与 prompt guide 不能“所有 key 集完全相等”，因为 resolver 正当拥有 world/event fallback key，而这些 key 不应暴露给生成器。正确的不变量是：**每个 topic 都有 SVG，guide 由每个 topic 生成；fallback 仅存在于 resolver**。把 fallback 强行塞进 prompt 只会泄露无意义的实现细节，属于把架构图当需求写给模型看，没必要。
