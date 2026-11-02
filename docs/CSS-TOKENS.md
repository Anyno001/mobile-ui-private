# CSS 与 UI 强制执行标准

本文档定义目标 UI，不迁就历史样式。目标是简约、舒适、一致：少量层级、足够留白、克制用色、清晰状态。`docs/BASELINE.md` 只保护运行与宿主兼容，不保护旧视觉。

## 1. 执行等级与范围

- **MUST**：违反即不得交付。
- **SHOULD**：默认遵守；偏离必须说明理由。
- **EXCEPTION**：仅限已确认的宿主或运行兼容边界，视觉历史债务不属于例外。

适用于 CSS、模板 class/内联样式、`element.style`、`style.setProperty`、SVG、媒体查询和动画。修改前 MUST 读取本文档与 `docs/BASELINE.md`。

## 2. 核心原则

1. 组件规则 MUST 使用已落地的语义 token，不得硬编码主题颜色、字号、间距、圆角、阴影、层级和动效值。
2. token 保持少而稳定。新全局 token 必须服务基础主题或至少两个组件族；单组件差异使用局部私有 token。语义相同不得重复命名。
3. 同类组件 MUST 使用同一配方，不复制旧组件的不一致值。
4. 视觉层级只依靠表面色、留白和字号/字重；菜单与模态可用对应的轻阴影。组件规则不得声明可见描边或分隔线，不得使用渐变；键盘焦点环不属于描边，必须保留。
5. 一个操作区域只应有一个明确主操作；其余操作使用普通或文字按钮。成功、警告、危险色只表达状态，不作普通装饰。
6. 亮色、暗色、键盘焦点、禁用态和移动端 MUST 同时验证。
7. 文档声明但尚未写入 `style.css` 的 token 属于待落地标准；必须在同一变更中先定义、再使用、再补契约检查。

### 2.1 视觉 v2 表面层级

| token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--pm-color-bg-grouped` | `#f2f2f7` | `#000000` | 分组列表页、信息流、今日风向的页面底 |
| `--pm-color-bg-plain` | `#ffffff` | `#1c1c1e` | 平铺页面、聊天列表、模态底 |
| `--pm-color-surface` | `#ffffff` | `#1c1c1e` | grouped 底上的卡片与分组 |
| `--pm-color-surface-raised` | `#ffffff` | `#2c2c2e` | 菜单、下拉、浮层 |
| `--pm-color-fill` / `--pm-color-fill-strong` | `#eeeef0` / `#e3e3e8` | `#333336` / `#424246` | 输入、普通按钮、分段底槽 / 按下态与开关关闭态 |
| `--pm-color-label` / `-2` / `-3` / `-4` | `#1c1c1e` / `#48484d` / `#6c6c72` / `#b8b8bf` | `#f2f2f7` / `#c7c7cc` / `#98989f` / `#5a5a5f` | 主 / 次 / 辅助 / 禁用文字 |
| `--pm-color-segment-selected` | `#ffffff` | `#5a5a5f` | 分段控件选中段 |

区分元素时先用 bg → surface → fill 三层，不加线。`border-*` 与 `surface-card/elevated/control/input`、`text-*` 为迁移期旧名，新规则不得使用。毛玻璃只允许三处：聊天磨砂气泡、桌面置顶条、今日风向底部标签栏。功能性边框只保留手机外壳、裁剪框与勾选框笔画；渐变只保留桌面壁纸压暗层。以上由 `scripts/check-contracts.mjs` 机器校验。

`0`、`auto`、`none`、`inherit`、`currentColor`、`100%`、布局函数、媒体查询条件、SVG path 和数据驱动坐标不视为视觉硬编码。运行时内联样式只允许承载数据值；稳定视觉必须回到 class 与 token。

简约不等于把所有内容缩小或变灰。关键文字必须清楚，触控区域必须舒适，信息密度通过分组、留白、折叠和滚动控制，不通过牺牲可读性控制。

## 3. Token 命名

仅允许以下全局类别：

| 前缀 | 用途 |
| --- | --- |
| `--pm-color-*` | 语义颜色 |
| `--pm-font-*` / `--pm-line-height-*` | 排版 |
| `--pm-space-*` | 间距 |
| `--pm-size-*` | 控件与图标尺寸 |
| `--pm-radius-*` | 圆角 |
| `--pm-shadow-*` | 阴影 |
| `--pm-z-*` | 层级 |
| `--pm-motion-*` | 动效 |
| `--pm-opacity-*` | 受控透明度 |
| `--pm-<feature>-*` | 已登记的组件私有 token |

`style.css` 是唯一加载入口，按固定顺序导入 `styles/core.css`、`styles/modal-settings.css`、`styles/community.css`、`styles/calendar.css`、`styles/today-trend.css`、`styles/gallery.css`、`styles/live.css`、`styles/video.css`、`styles/shop.css`、`styles/origin.css`、`styles/greenlin.css` 和 `styles/overrides.css`。全局 token 只能定义在 `styles/core.css` 的统一 token 区，并在本文档登记语义、亮暗值和适用组件族。组件私有 token 只用于组件内部重复出现、含义稳定且无法直接复用公共 token 的值；必须定义在组件根选择器作用域内，以稳定 feature 名命名，并在定义旁登记用途、新增理由和适用主题。已登记私有 token 的声明值可使用必要原始值，主题相关值必须亮暗成对；该豁免只适用于变量声明，消费规则仍必须引用 token。不得把私有 token 放入全局区伪装成公共能力，也不得为每条声明机械创建变量。变量名描述用途，不描述当前数值。

| 私有 token | 根选择器 | 语义与适用范围 |
| --- | --- | --- |
| `--pm-scene-topbar-height` | `.pm-scene-shell` | 场景顶栏的稳定结构高度；同时锚定顶栏菜单的 `top`，避免两个 `38px` 声明漂移。仅社区场景使用，不随主题改变。 |
| `--pm-scene-post-body-letter-spacing` | `.pm-scene-shell` | 社区帖子正文专用的扩展字距；避免提高评论字距，仅 `.pm-scene-post p` 消费，不随主题改变。 |
| `--pm-scene-body-letter-spacing` | `.pm-scene-shell` | 社区评论正文的轻度字距，改善小字号中文阅读的视觉呼吸感；仅 `.pm-scene-comment-content` 消费，不随主题改变。 |
| `--pm-scene-quote-bar-width` | `.pm-scene-shell` | 小组论坛楼层引用块左侧点缀色条的宽度；公共间距尺度没有 3px，仅 `.pm-scene-quote::before` 消费，不随主题改变。 |
| `--pm-scene-star-size-large` | `.pm-scene-shell` | 社区整页编辑页顶部星级选择的星号字号（28px，展示型）；公共字号尺度最大 20px，仅 `.pm-scene-sheet-rating .pm-scene-star` 消费，不随主题改变。 |
| `--pm-community-accent` | `[data-community-platform]`、`.pm-scene-shell[data-community-platform="night"]` | 社区点缀色，按平台取值（weibo、douban、review、confess、night；浅色 `#e0806a #5f9a86 #e08e55 #8f86c6 #6f7fc4`，深色 `#e8957f #78b29e #e8a06d #a59dd6 #aeb8ec`），只用于图标、选中、标签、星级、话题词；社区自选主题色只覆盖该变量。夜间来信固定使用深色值，不跟随整机浅深色。 |
| `--pm-community-accent-soft` | `[data-community-platform]` | 点缀色浅底：`color-mix` 混进不透明的 `--pm-color-surface`，得到实色；用于平台卡片选中态、标签、小组首字图标底。B2 四个平台（moments、xhs、zhihu、news）按方案稿直接给实色，与点缀色同行声明：浅色 `#5f88b8/#eaf0f6`、`#d4616c/#f9eaec`、`#4f8fb8/#e8f0f6`、`#3f5f8f/#e2eaf6`，深色 `#8ca9cc/#323841`、`#e08d95/#433336`、`#80aecc/#303941`、`#758cae/#2e323b`；社区自选主题色时（元素带内联 `--pm-community-accent`）浅底改回 `color-mix` 跟随自选色。 |
| `--pm-community-breaking` / `-breaking-soft` | `.pm-scene-shell` | 今日猴条「突发」小标签的红字与浅红底，只用于这一个标签，与平台点缀色分开。浅色 `#b8392f/#fbe4e1`，深色 `#ef8b84/#4a3231`，亮暗成对。 |
| `--pm-scene-headline-size` / `--pm-scene-heading-size` | `.pm-scene-shell` | 社区展示型标题字号 20px / 18px（公共尺度到 16px 为止）：前者用于新闻正文页大标题、小红书笔记页封面大字；后者用于小红书笔记标题、知乎问题页标题、新闻要闻卡标题。不随主题改变。 |
| `--pm-community-note-1..5` / `--pm-community-note-edge-1..5` | `.pm-scene-shell` | 便签五色与对应书脊色，树洞便签与书评书封共用，文字一律用 `--pm-color-label`。浅色底 `#ecebf7 #f9e8ee #e6f1ed #fdf3e2 #e7eef8`，书脊 `#d9d6ef #efd3dd #cfe4dc #f3e2c4 #d2dfee`；深色各给一组暗的实色，亮暗成对。 |
| `--pm-community-night-card` / `-stamp` / `-avatar` | `.pm-scene-shell[data-community-platform="night"]` | 夜间来信的话题卡底 `#262a45`、邮戳底 `#3a4170`、头像底 `#2c3150`；该平台固定暗色，不分浅深色成对。 |
| `--pm-live-cover-1..5` / `-cover-ink` | `.pm-live-shell` | 直播间卡片封面的五组柔和实色（浅色 `#f4b6cc #a9cdf2 #a6e0c5 #fbcf9a #cbbcf2`，深色各给一组更深的实色）与封面上的文字色，按房间 id 哈希取色；不用灰色与莫兰迪色。亮暗成对。 |
| `--pm-live-badge-bg` / `-badge-ink` / `-badge-off-ink` | `.pm-live-shell` | 列表封面上「直播中」「未开播」小胶囊的底色与文字色，压在柔和封面上，浅深色同值，不随主题改变。 |
| `--pm-live-pink` / `-pink-ink` / `-gold` / `-heart` / `-flame` / `-alert` / `-host-fly` | `.pm-live-shell` | 直播间画面（照 IGS 的 B 站竖屏直播间，固定深色）的强调色：粉（主播头像、关注、主播标签，文字用 `-pink-ink` 以达 4.5:1）、金（礼物行与礼物飘屏）、心形粉、火焰橙、报错浅红、主播飘屏浅粉。不随主题改变。 |
| `--pm-live-veil` / `-glass` / `-host-veil` / `-name-dim` / `-ring` / `-shadow` | `.pm-live-shell` | 直播间画面上叠加层的半透明色：评论条底、输入胶囊与圆钮底、主播发言条底、评论名字淡白、头像描环白、文字阴影黑。画面叠加层按 IGS 保留半透明；列表页与开播页仍用实色。 |
| `--pm-live-ghost` / `-initial-ink` / `-mask-ink` | `.pm-live-shell` | 画面中央主播首字圆的背景色（比叠加层更淡的白，作背景不与横飞抢位置），以及评论区与横飞区边缘渐隐遮罩的不透明遮罩色（只用于 mask-image，不产生可见色）。不随主题改变。 |
| `--pm-live-cover-height` / `-initial-size` / `-play-size` / `-ring-size` / `-textarea-height` / `-lane-pitch` / `-fly-top` / `-fly-share` / `-center-top` / `-fade` / `-bar-height` / `-list-height` | `.pm-live-shell` | 直播页固定几何：封面高度、封面与画面中央主播首字字号（展示型）、播放圆钮图标、首字圆环、设定输入框最小高度，以及直播间内飘屏轨道间距、横飞区起点与下沿（占画面高度的比例，轨道数按此高度除以轨道间距）、中央区顶部、渐隐遮罩长度、底部输入条高度、评论叠层高度。不随主题改变。 |
| `--pm-live-video-stage` / `-video-cc` / `-video-ink` / `-video-soft` / `-video-lanes` | `.pm-live-shell`（视频分区的 `.pm-video-*` 也登记为该前缀的根） | 视频分区（噼哩噼哩「视频」）：画面区暗底（固定深色，不随主题）；分镜字幕底块（照 IGS 全屏直播自动字幕 CC 的近黑实色，固定不随主题）；点缀字色与评论新增高亮、当前分镜行的淡底（实色，亮暗成对，字色 ≥ 4.5:1）；弹幕飞行区的轨道数（3 条，与 `src/video-format.js` 的 `VIDEO_FLY_LANES` 一致）。其余颜色、封面五色、表单、按钮、飞行弹幕沿用直播的 token 与 class。 |
| `--pm-shop-accent` / `-accent-soft` / `-accent-ink` / `-on-accent` | `.pm-shop-shell` | 桃宝（原型淘宝）蜜桃点缀色：点缀（浅色 `#dc7d7a`，深色 `#ee9a97`，只用于星级、空状态图标、订单栏下划线这类非文字元素）、浅底（`#fcebea` / `#3d2a29`，规格胶囊、服务标签、追评块、加入购物车）、深字（`#b4524f` / `#f4b4b1`，价格、浅底上的文字、选中的勾选圆与底栏当前项，白底上 4.93:1）、深字实底上的前景（白 / 近黑）。全部实色，亮暗成对。 |
| `--pm-shop-swatch-1..6` / `-swatch-ink` | `.pm-shop-shell` | 商品图占位的六色实色块与块上的描述文字色（浅色 `#f6cfd6 #c9def5 #cdebd9 #fbe0bd #ddd5f5 #f3e7b9`，深色各给一组暗的实色），按商品 id 哈希取色；以后接生图时换成图片。亮暗成对。 |
| `--pm-shop-veil` / `-veil-ink` | `.pm-shop-shell` | 商品页大图上返回、购物车圆钮的半透明底与图标色；只用于压在商品图上的叠加层，其余界面一律实色。亮暗成对。 |
| `--pm-shop-side` / `-photo-tall` / `-photo-mid` / `-photo-short` / `-hero-height` / `-thumb` / `-check` / `-step` / `-avatar` / `-logo` / `-art` / `-art-icon` / `-price-size` / `-price-large` / `-indicator` / `-indicator-inset` | `.pm-shop-shell` | 桃宝固定几何：顶栏左右两组的等宽列（保证标题在整屏正中）、瀑布流商品图三档高度、商品页大图高度、购物车与订单缩略图、勾选圆、数量加减钮、评价头像、店铺头像、空状态插画圆与其图标、价格数字字号（展示型 18px 与商品页 24px）、订单栏下划线的高度与左右内缩。不随主题改变。 |
| `--pm-origin-tier-n` / `-r` / `-sr` / `-ssr` / `-ur` 与各自 `-ink` | `.pm-origin-shell` | 金手指稀有度五档的浅底与深字（浅色 `#eef0f4/#4f5664`、`#e3eefb/#2f5f93`、`#ece6fb/#5b47a3`、`#fcecd9/#8a5310`、`#fbe4ea/#a33a58`，深色各给一组暗的实色），只用于稀有度小标与抽奖结果卡。全部实色，亮暗成对。 |
| `--pm-origin-bar` / `-number` / `-menu` / `-art` / `-art-icon` / `-hero-title` / `-sheet-max` | `.pm-origin-shell` | 金手指固定几何：进度条高度、数字输入框宽度、⋯ 菜单宽度、空状态插画圆与其图标、主线大卡与抽奖结果的展示型标题字号（18px）、底部表单最大高度。不随主题改变。 |
| `--pm-desktop-badge` | `.pm-desktop-app-badge` | 桌面图标右上角红点的直径（9px）；颜色用 `--pm-color-danger`。不随主题改变。 |
| `--pm-calendar-day-height` / `-day-circle` / `-dot` / `-band-inset` / `-textarea-height` / `-rule-height` | `.pm-calendar-shell` | 日历 v3 页面几何：月历日期格高度、日历小圆点直径、生理期色带上下内缩、设置页多行输入与生成规则框的最小高度。不随主题改变。 |
| `--pm-calendar-holiday*` / `-occasion*` / `-outfit-*` / `-meal-*` / `-band-*` / `-weather` | `.pm-calendar-shell` | 分类色：节假日、纪念日、穿搭、菜谱胶囊的浅底与文字，生理期月格色带与图例，天气月格图标色。只用于日历小标记与分类胶囊，不用于选中态；亮暗成对。 |
| `--pm-calendar-status-value-size` / `-scene-height` / `-ring-*` / `-status-ink*` | `.pm-calendar-status-card` | 状态卡几何与前景：大号数值字号、天气风景卡高度、周期圆环尺寸/线宽/中心数字，以及压在风景画上的文字色（雷阵雨与夜间为白字）。 |
| `--pm-calendar-sky` / `-far` / `-near` / `-front` / `-water` / `-glint` / `-sun` / `-halo` / `-cloud*` / `-tree` / `-mist` / `-rain` / `-snowcap` / `-flake` / `-bolt` | `.pm-calendar-status-card` | 天气风景画的分层实色，按 `data-weather-scene`（晴/多云/雨/雪/雾/雷阵雨）覆盖；夜间不另设色板，由 `.pm-calendar-status-art` 的 `filter` 统一压暗。属品牌插画，不受普通界面渐变禁令约束，但仍全部实色。 |
| `--pm-calendar-cycle-*` / `--pm-calendar-ring-period` / `-fertile` / `-rest` / `-today` | `.pm-calendar-status-card` | 生理期状态卡底色、文字与圆环分段色；易孕期按 `data-cycle-phase="ovulatory"` 切到浅紫组；亮暗成对。 |
| `--pm-calendar-dialog-width` | `.pm-calendar-month-dialog` | 跳转日期弹窗宽度，与 `.pm-calendar-entry-dialog` 一致；弹窗渲染在 `#pm-overlay`，不继承 `.pm-calendar-shell` 的 token。 |
| `--pm-gallery-chat-photo-max` | `.pm-img-card` | 聊天图片卡里图片的最大高度（260px），竖图不占满一屏；只给 `.pm-img-card-photo img` 用，不随主题变化。 |
| `--pm-today-trend-*` | `.pm-today-trend-shell` | 今日风向共享的标题字距、统计计量与事件时间线几何；派生自公共 token，不随主题独立变化。 |
| `--pm-today-trend-world-*` | `.pm-today-trend-world` | 世界态势的头部、信号轨道、摘要与收尾装饰参数；颜色从公共语义 token 派生。 |
| `--pm-today-trend-reputation-*` | `.pm-today-trend-reputation` | 个人风评的图标、评级尺和收尾装饰尺寸；颜色从公共语义 token 派生。 |
| `--pm-today-trend-faction-*` | `.pm-today-trend-factions` | 势力图谱的菱形节点、关系量表与递归层级缩进；颜色从公共语义 token 派生。 |
| `--pm-today-trend-dynamics-*` | `.pm-today-trend-dynamics` | 事件追踪的节点、连续轨道与时间线定位参数；颜色从公共语义 token 派生。 |
| `--pm-today-trend-relation-*` | `.pm-today-trend-shell` | 个人风评与势力图谱五档关系圆的局部语义表面色及对应前景：敌对→danger/on-danger、不喜→warning/on-warning、中立→surface-control/text-primary、喜爱→accent/on-accent、信任→success/on-success；SVG 通过 `currentColor` 消费。 |

## 4. 颜色与表面

| 语义 token | 浅色 | 深色 |
| --- | --- | --- |
| `--pm-color-surface-page` | `#ffffff` | `#1c1c1e` |
| `--pm-color-surface-card` | `#f8f8fa` | `#242429` |
| `--pm-color-surface-elevated` | `#f2f2f7` | `#252527` |
| `--pm-color-surface-control` | `#f2f2f7` | `#2c2c2e` |
| `--pm-color-text-primary` | `#1c1c1e` | `#eeeeef` |
| `--pm-color-text-secondary` | `#55545c` | `#d1d1d6` |
| `--pm-color-text-tertiary` | `#7a7a82` | `#a9a9b0` |
| `--pm-color-border-subtle` | `#f0f0f2` | `#38383a` |
| `--pm-color-border-default` | `#dedfe6` | `#414149` |
| `--pm-color-border-strong` | `#b7b7bd` | `#48484a` |
| `--pm-color-accent` | `#1677d2` | `#0a84ff` |
| `--pm-color-auxiliary` | 当前主题预设的相邻色或对比色；自定义主题按强调色色相映射到独立辅助色 | 同左 |
| `--pm-color-success` | `#2e9e6a` | `#4cc08a` |
| `--pm-color-warning` | `#c98a12` | `#e0a63a` |
| `--pm-color-danger` | `#d64545` | `#ef6b6b` |
| `--pm-color-focus-ring` | `#1677d2` | `#64a8ff` |
| `--pm-color-overlay` | `rgba(0,0,0,.45)` | 同左 |

状态附属 token 固定如下，不再扩张灰阶：

| Token | 浅色 | 深色 |
| --- | --- | --- |
| `--pm-color-text-placeholder` | `#9a9aa1` | `#8e8e93` |
| `--pm-color-text-disabled` | `#b8b8bf` | `#636366` |
| `--pm-color-control-off` | `#d1d1d6` | `#48484a` |
| `--pm-color-on-accent` | `#ffffff` | 同左 |
| `--pm-color-on-dark` | `#ffffff` | 同左 |
| `--pm-color-on-light` / `--pm-color-on-success` / `--pm-color-on-warning` | `#000000` | 同左 |
| `--pm-color-on-danger` | `#ffffff` | `#000000` |

`--pm-color-surface-input` 作为迁移别名映射到 control，新组件不得使用旧名。

正文与有阅读价值的说明文字对比度 MUST 达到 4.5:1，大号文字、图标和非文字控件边界达到 3:1。填充按钮必须使用表中对应的 `on-*` 前景，不能默认一律使用白字。普通界面不使用渐变；品牌插画或用户内容除外。

透明度只保留两档：`--pm-opacity-disabled:.45` 与 `--pm-opacity-muted:.62`。前者用于禁用控件，后者用于非当前图标、装饰或不参与当前任务的整体区域。有阅读价值的正文和说明文字优先使用 secondary/tertiary 文字色，不得通过 opacity 降低可读性；遮罩只使用 `--pm-color-overlay`。

`accent/success/warning/danger` 可直接用于达到 3:1 对比度的图标和控件描边，不再为每种用途复制 `icon-*`、`border-*` token。只有实测达到 4.5:1 时才可直接用于普通字号文字；否则标签使用 primary 文字，并用语义图标、描边和文案共同表达状态。选中态优先使用现有 control/card 表面配合满足对比度的 accent 图标或描边；只有跨两个以上组件族仍无法清晰表达时，才允许新增全局选中态 token。

`--pm-color-auxiliary` 只表达与主题强调色不同色系的配套辅助色，统一用于圆形交互按钮、圆形选择控件与胶囊开关的开启态；成功、警告和危险状态仍使用各自语义 token，不得以辅助色替代。主题预设不得仅通过调整强调色明度生成辅助色。

强调色派生色调由 `src/theme-tones.js` 按当前强调色计算，`phone-theme.js` 随主题写入；只保留强调色的色相与彩度，亮度按用途固定，因此预设与自定义强调色（含极浅色）都满足对比度。样式表中的值是默认蓝灰主题的兜底，强调色无法解析时生效。

| token | 浅色兜底 | 深色兜底 | 用途 |
| --- | --- | --- | --- |
| `--pm-color-accent-soft` | `#d9edff` | `#1f3a56` | 选中或进行中的浅色块（卡片、选项行、胶囊），只表达状态，不做主按钮 |
| `--pm-color-on-accent-soft` | `#243e5e` | `#ddedff` | 位于 accent-soft 上的文字与图标，对比度 ≥ 8:1 |
| `--pm-color-accent-strong` | `#5a7799` | `#6b89aa` | 进行中状态的实心小控件（如播放/暂停圆钮），白色图标对比度 ≥ 3.5:1 |

hover 与 active 优先通过现有表面色、文字色和描边变化表达，不为每个组件创建透明混色 token。确需半透明语义层时，必须先证明三层表面色无法表达，并使用组件私有 token。


## 5. 排版

公共字号以 9/10/11/12/13/14/15/16/18/20px 为受控尺度；组件展示型字号使用私有 token：

| Token | 值 | 用途 |
| --- | ---: | --- |
| `--pm-font-family-system` | `'Tianyin Rounded',-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif` | 全局界面字体栈；首选随插件分发的有爱圆体（Nowar Rounded，OFL，见 `assets/fonts/OFL.txt`），按 `unicode-range` 分片按需加载；组件不得写裸 sans 字栈 |
| `--pm-font-family-mono` | `ui-monospace,SFMono-Regular,Consolas,monospace` | 代码、文件号等等宽内容 |
| `--pm-font-size-micro` | `9px` | 极小装饰或空间极窄的非关键元信息 |
| `--pm-font-size-caption` | `10px` | 图标标签、紧凑次要元信息；不得承载关键内容 |
| `--pm-font-size-helper` | `11px` | 时间、辅助说明；不得承载关键内容 |
| `--pm-font-size-label` | `12px` | 表单标签、次级说明 |
| `--pm-font-size-compact` | `13px` | 紧凑列表、次级控件文案 |
| `--pm-font-size-body` | `14px` | 正文、按钮、输入、列表控件、聊天内容 |
| `--pm-font-size-subtitle` | `15px` | 紧凑标题与重点数据；原 17px 收敛至此 token |
| `--pm-font-size-title` | `16px` | 页面与模态标题 |
| `--pm-font-size-icon` / `--pm-font-size-icon-lg` | `18px` / `20px` | 字符图标字形；不得替代尺寸 token |
| `--pm-font-weight-regular` | `400` | 正文 |
| `--pm-font-weight-medium` | `500` | 次级强调 |
| `--pm-font-weight-semibold` | `600` | 控件和标题 |
| `--pm-line-height-tight` | `1.2` | 单行标题、按钮 |
| `--pm-line-height-control` | `1.4` | 控件和说明 |
| `--pm-line-height-body` | `1.5` | 多行正文 |
| `--pm-line-height-loose` | `1.75` | 需要更舒展阅读节奏的长正文 |

MUST 从表中选择。控件与正文统一使用 14px，避免为了紧凑牺牲可读性。10px 及以下只允许非关键装饰；17px 以上只允许少量页面主标题或数据展示，并定义组件私有 token。正文不使用超粗字重、全大写或过密行高。字重只允许 400/500/600 三档，不得使用 650/700/750 等非标准字重，避免不同系统字体映射不一致。

全局定义：`--pm-font-family-system:'Tianyin Rounded',-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif`、`--pm-font-family-mono:ui-monospace,SFMono-Regular,Consolas,monospace`、`--pm-line-height-loose:1.75`。

生产规则的 `font-family` 必须使用 `--pm-font-family-system`、`--pm-font-family-mono` 或 `inherit`；`font` 简写的 family 部分必须使用字体 token，`inherit` 只能作为完整的 `font:inherit` 声明。

生产规则的 `line-height`（含 `font` 简写）必须引用已登记的公共 `--pm-line-height-*` token。图标、固定行盒与展示排版确实需要字面行高时，必须逐项登记在 `css-governance-registry.json` 的 `lineHeightExceptions`，并写明 owner、原因与移除条件；未登记字面量由 checker 拒绝。

## 6. 间距、尺寸与圆角

| 类别 | 标准 |
| --- | --- |
| 间距 | 基础尺度：`--pm-space-0:0`、`--pm-space-0-5:2px`（极小间隙）、`--pm-space-1:4px`、`--pm-space-1-5:6px`（半档）、`--pm-space-2:8px`、`--pm-space-3:12px`、`--pm-space-4:16px`、`--pm-space-5:24px`；布局关键字：`--pm-space-auto:auto`、`--pm-space-full:100%`；遗留像素级对齐：`--pm-space-px-*` 与 `--pm-space-neg-4`，仅用于迁移中已存在的非标准值，不得为新组件扩张。 |
| 控件高度 | `--pm-size-control-sm:28px`（分段与行内小操作）、`--pm-size-control:36px`（默认）、`--pm-size-control-lg:44px`（整宽主按钮与列表行）；开关统一使用 `--pm-size-switch-*`（40×24，滑块 20） |
| 图标 | `--pm-size-icon-sm:14px`、`--pm-size-icon-md:18px`、`--pm-size-icon-lg:24px` |
| 圆角 | 容器尺度：`--pm-radius-compact:8px`、`--pm-radius-panel:12px`、`--pm-radius-card:14px`、`--pm-radius-large:16px`、`--pm-radius-round` / `--pm-radius-modal:20px`；控件使用 `--pm-radius-control:10px`；结构性零值、圆形、胶囊使用 `--pm-radius-none:0`、`--pm-radius-circle:50%`、`--pm-radius-pill:999px`。气泡/语音卡仅使用 `--pm-radius-bubble:18px` 与 `--pm-radius-bubble-tail:4px`；宿主手机外壳仅使用随断点覆盖的兼容 token `--pm-phone-outer-radius`。 |

组件内部默认 gap 为 8px，内容区内边距优先 12px 或 16px。MUST 保留留白，不得靠缩小字体或行高塞入更多内容。普通按钮与输入使用 36px，整宽主按钮与列表行使用 44px。圆角只表达容器层级，不得每个子元素都套卡片。

## 7. 阴影、层级与动效

只保留两种轻阴影：`--pm-shadow-floating:0 4px 12px rgba(30,30,46,.06),0 12px 32px rgba(30,30,46,.10)` 用于菜单/下拉；`--pm-shadow-modal:0 8px 24px rgba(30,30,46,.08),0 24px 56px rgba(30,30,46,.14)` 用于模态。普通卡片不使用阴影；手机宿主壳阴影属于兼容例外。

层级只保留：`--pm-z-base:0`、`--pm-z-menu:20`、`--pm-z-popover:30`、`--pm-z-modal:40`、`--pm-z-host:2147483647`。组件消费规则必须引用对应的 `--pm-z-*` token，不得重复写入其数值。模态遮罩与面板处于同一 modal 层级容器，面板通过 DOM 顺序覆盖遮罩。不得为解决遮挡创建 21、31、9999 等临时值；先检查 stacking context。

动效只保留：`--pm-motion-fast:120ms`、`--pm-motion-normal:180ms` 和 `--pm-motion-ease:cubic-bezier(.2,.8,.2,1)`。界面动效应轻微、短促，不使用弹跳、持续闪烁、夸张缩放或 `transition:all`。新增动画 MUST 在 `prefers-reduced-motion:reduce` 下由组件自身规则取消非必要动画和过渡；状态变化直接呈现，不新增 reduced-motion 时长 token，也不得通过全局 `*` 规则覆盖宿主。

## 8. 标准组件配方

| 组件 | 标准 |
| --- | --- |
| 普通按钮 | `--pm-color-fill`、`--pm-color-label`、无描边、`--pm-radius-control`、`--pm-size-control` |
| 主按钮 | `--pm-color-accent` 背景、`--pm-color-on-accent` 前景、无描边；同一操作区域默认只出现一个 |
| 状态按钮 | 默认使用 `--pm-color-surface-control` 和 primary 标签文字，以对应的 `success/warning/danger` 作为达到 3:1 的图标与描边；语义色文字仅在实测达到 4.5:1 时使用。只有不可逆操作的最终确认才使用语义色实底与对应 `--pm-color-on-*` 前景 |
| 文本输入 | `--pm-color-fill`、`--pm-color-label`、无描边、`--pm-radius-control`、`--pm-size-control`；校验失败用 danger 色 outline |
| 卡片 | grouped 底上用 `--pm-color-surface`，plain 底上用 `--pm-color-fill`；无描边、无阴影；`--pm-radius-card`、space-3 或 space-4 内边距 |
| 模态 | `--pm-color-surface-page`、`--pm-radius-modal`、`--pm-shadow-modal`、`--pm-z-modal`；遮罩使用 `--pm-color-overlay`。MUST 具备对话框语义、可访问标题、焦点进入与约束、关闭后焦点恢复，并提供明确关闭操作 |
| 菜单/下拉 | `--pm-color-surface-raised`、`--pm-shadow-floating`、无描边；菜单项至少 `--pm-size-control` 高度 |
| 图标按钮 | 独立操作使用 control 表面与 default 正方形点击区；只有工具栏或图标操作组等明确紧凑区域可使用透明表面与 compact 点击区；图标使用 `--pm-size-icon-md` |

同类组件不得自行创造第二套视觉。组件嵌套时避免“卡片套卡片”；优先用留白和分隔线组织内容。

### 设置表单与分组垂直节奏

设置页、模态表单和管理面板 MUST 使用以下层级，不得以组件私有间距或裸像素值做视觉微调：

| 关系 | 强制值 | 用途 |
| --- | --- | --- |
| 内容区内边距 | `--pm-space-3` 或 `--pm-space-4` | 页面、滚动区或模态正文的边缘留白；按信息密度选择其一 |
| 独立分组之间 | `--pm-space-3` | 卡片、fieldset 或功能模块之间的页面级分隔 |
| 分组内边距 | `--pm-space-3` | 静态表单分组四边一致；只有固定页眉、页脚或滚动边缘等结构性原因才能不对称 |
| 分组标题至首个表单项 | `--pm-space-2` | `legend`、小标题或分组说明与所属表单项之间 |
| 相邻表单项 | `--pm-space-2` | 同一分组内的 label/control 单元之间 |
| 标签至所属控件 | `--pm-space-1` | 标签、简短说明与 input、select、textarea 等控件之间 |

表单标签使用 `--pm-font-size-label` 和 `--pm-line-height-control`；辅助说明使用 `--pm-font-size-helper`，其行高至少为 `--pm-line-height-control`；连续阅读的多行正文使用 `--pm-line-height-body`。标题、分组、表单项和控件的间距必须由父容器的 `gap` 表达，不得同时叠加子元素 margin 制造同一方向的间隔。

`padding:10px 11px 11px`、`gap:9px`、`margin-top:7px` 一类未登记的手调值不构成视觉语义，MUST NOT 用于设置表单。相邻层级需要更疏或更紧时，应从现有 space token 中选择并说明对应关系；不得为单个页面新增 `--pm-<feature>-gap` 一类私有 token。四边 padding 不相等时，规则必须在同一选择器注释或文档中说明其固定头尾、滚动边缘或控件对齐依据。

成功与警告通常是反馈状态，不应自动变成大面积实色按钮。危险实色只用于删除、清空等不可逆操作的最终确认，避免界面长期充斥高饱和色。

## 9. 交互状态

- 按钮 MUST 覆盖 default、focus-visible、disabled；在设备支持对应交互时覆盖 hover、active。异步按钮增加 loading，期间阻止重复激活，并通过 `aria-busy`、状态文案或等价机制暴露忙碌状态。
- 输入 MUST 覆盖 default、focus-visible、disabled、placeholder；按实际能力覆盖 invalid、readonly 和 autofill。
- focus-visible 统一使用 2px focus-ring，不能被 hover 覆盖。
- 选中、展开、按下等持久状态必须同时更新视觉与对应的 `aria-selected`、`aria-expanded`、`aria-pressed` 或等价语义；不得只依赖 hover 表达当前状态。
- disabled 最后生效，不响应 hover/active；loading 保持尺寸稳定。
- 错误、警告、成功反馈必须有文案或图标，不能只靠颜色。
- 优先使用原生交互语义；ARIA 只补充原生语义缺口。图标按钮必须有可访问名称；开关必须维护 `aria-checked` 或等价状态。模态 MUST 使用原生 dialog 或 `role="dialog"` 与 `aria-modal="true"`，关联可访问标题，打开后将焦点移入并约束在模态内，关闭后恢复到触发元素；支持 Escape 关闭时不得绕过未保存或高风险确认。

## 10. 响应式与布局

MUST 优先使用 flex/grid。absolute 只用于角标、锚定菜单和装饰；fixed 只用于宿主级 UI。不得用负 margin、整体 scale 或 transform 偏移掩盖布局问题。

保留 `500px/700px` 宿主断点和 `320px` 窄屏组件断点。响应式优先调整列数、gap、padding、换行和滚动区域，不缩小正文字号。主要触控目标保持 default 高度，只有已定义的紧凑操作区可使用 compact 高度。移动端、最小化状态和动态视口高度分别验证。

## 11. 禁止模式

- MUST NOT 在组件消费规则中新增主题相关 hex、rgb、hsl、命名色或渐变；按第 3 节登记的组件私有 token 声明除外。
- MUST NOT 使用未登记的字号、间距、圆角、阴影、z-index、透明度和动画时长；布局计算值、数据驱动值及按第 3 节登记的组件私有 token 声明除外。
- MUST NOT 在组件规则中写裸 `font-family` 或在 `font` 简写中内嵌字栈；仅可消费第 5 节登记的字体 token 或 `inherit`。
- MUST NOT 为单个组件创建新的全局 token；确有独立语义时使用局部私有 token。
- MUST NOT 使用 `outline:none` 或等价规则移除键盘焦点，除非同一规则提供符合本文档的 focus-visible 替代。
- MUST NOT 使用无 reduced-motion 路径的非必要动画，也不得使用 `transition:all`。
- MUST NOT 同时使用高饱和背景、粗描边和重阴影制造“重点”。
- MUST NOT 把稳定视觉声明塞进 HTML/JavaScript 内联样式。
- MUST NOT 只验证浅色、hover 或桌面尺寸。
- MUST NOT 为保留旧视觉而拒绝迁移，也不得破坏 `docs/BASELINE.md` 的运行兼容契约。

## 12. 执行 AI 工作流

1. 读取本文档与 `docs/BASELINE.md`。
2. 搜索目标组件的选择器、覆盖规则、内联样式、运行时 style 写入和调用方。
3. 选择本文档已有 token；缺失时先判断能否用现有语义解决，不能则说明新增必要性。
4. 若 token 尚未落入所属 `styles/*.css` 模块，在同一变更中定义、使用并补充契约检查。
5. 同时实现亮暗主题和适用的全部交互、移动状态。
6. 搜索本组件族残留的旧硬编码；在同一安全范围内一并迁移。
7. 运行构建、语法检查、契约检查和 `git diff --check`。
8. 交付时列出 token、状态覆盖、例外、未迁移范围和验证结果。

## 13. 机器约束与迁移

`scripts/check-contracts.mjs` MUST 检查：目标 token 存在；亮暗主题成对；已迁移组件引用规定 token；状态背景/文字/边框成套；已登记 component root 确有 CSS owner；私有 token 的声明与消费均处于登记 root；稳定 JS 内联写入逐文件逐属性匹配 `inline.allowedWrites`；组件消费规则不存在未登记的裸色值、字体家族、字号、间距、圆角、z-index、transition 或 `transition:all`；所有 `var(--*)` 消费必须指向已声明 token、已登记运行时 token 或显式外部 token；宿主契约仍有效。`legacyValues` 只列出经审计仍有运行/兼容语义的值并按类别 fail-fast；`spacing` 台账必须精确绑定 CSS 路径、selector、property、value、owner、原因和移除条件，`0`、`auto`、`100%`、`50%` 等固有布局值不进入台账。已清空的 `fontSize`、`lineHeight`、`radius`、`zIndex` 类别由检查器强制保持为空，重新引入必须先建立可验证的迁移或有限例外。全局 token 与已登记组件私有 token 声明中的原始值不属于违规硬编码，私有 token 的消费规则不得直接使用原始值。

阶段一收尾的机器事实以 `scripts/css-governance-registry.json` 为准：`legacyValues.spacing` 当前为 44 条精确台账，`lineHeightExceptions` 为 22 条，`animationExceptions` 为 3 条；所有例外必须绑定 path、selector、property、value、owner、reason 和 removeWhen。`--pm-space-px-*` 当前冻结为 16 个已存在 token，只允许缩减，不允许新增；新增声明和 registry stale token 均由 checker 拒绝。`animation` 的普通 duration/easing 必须使用 `--pm-motion-fast`、`--pm-motion-normal` 与 `--pm-motion-ease`，持续状态动画只能使用精确登记例外。

阶段一已知视觉风险不通过治理白名单掩盖：calendar occasion 对比度问题归入阶段二 V5 日历统一，danmaku row 对比度问题归入 V4 社区与桌面统一；host-shell、cropper 与 `.pm-name-trigger` stacking seam 保留为有 owner/reason/removeWhen 的精确例外。真实宿主回归、截图和人工视觉验收属于最终提交检查，不阻塞阶段一代码治理退出。

迁移按组件族分批进行：全局 token → 基础控件 → 卡片/模态/菜单 → 列表/导航 → 聊天 → 社区 → 日历。每批独立构建和回归。旧视觉断言应替换为新标准断言，行为和宿主契约继续保留。

## 13.1 CSS 治理登记

以下 class 由 CSS 治理引入，替代稳定内联视觉，语义与既有组件配方一致：

| class | 语义 | 对应原内联 |
| --- | --- | --- |
| `.pm-confirm-bar`（默认隐藏 + `.is-active` 显示） | 删除确认栏初始隐藏、选中模式显示 | `style="display:none"` / `style.display` 切换 |
| `.pm-select-wrap[data-align]` | 选择包装器按 side 对齐（left/center/right） | `wrap.style.cssText` 中的 `align-self` |
| `.pm-msg-list-empty` / `.pm-modal-list-empty` | 消息/联系人空态 | 空态内联文本样式 |
| `.pm-emoji-placeholder` | 聊天表情缺失/不可加载占位 | 占位内联字号与文字色 |
| `.pm-emoji-image` | 聊天表情图片固定规格 | emoji `<img>` 内联尺寸/圆角/阴影 |
| `.pm-bubble.is-image-only` | 图片独占气泡去泡化 | `element.style.background/boxShadow/padding` 清空 |
| `.pm-voice-text[hidden]` | 语音文字默认隐藏 | `style="display:none"` |
| `.pm-action-button.is-full` / `.is-flex-1` / `.is-flex-2` | 模态底部按钮整宽或 flex 权重 | footer 内联 `width:100%` / `flex:1` / `flex:2` |
| `.pm-settings-modal` | 设置模态固定高度 | `style="height:560px"` |
| `.pm-inline-label` | 设置行内标签去除默认 margin | `style="margin:0"` |
| `.pm-group-counter.has-members` | 群聊成员计数状态色 | `counter.style.color` |

这些 class 的 CSS 定义位于对应 `styles/*.css` 组件模块，且纳入 `scripts/css-governance-registry.json` 的例外与组件根登记。群聊成员动态色、语音长度宽度、锚定坐标、主题变量注入仍属于运行时数据通道，不迁移。

## 14. 最终验收

- [ ] token 数量没有因单个组件继续膨胀。
- [ ] 同类组件配方一致，页面没有卡片、描边和色彩堆叠。
- [ ] 留白、字号、行高和触控尺寸舒适。
- [ ] 每个操作区域的主操作唯一，状态色使用克制。
- [ ] 亮暗主题、交互状态、移动端和可访问性完整。
- [ ] 组件规则无新增视觉硬编码，契约检查已同步。
