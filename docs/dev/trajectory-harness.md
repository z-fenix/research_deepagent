# 前端 harness 框架与 Trajectory（task08 + task09 refinements）

参照 `deepseek-harness` web 前端 1:1 复刻的布局与轨迹能力（自栈重写）。
task09 落地了 sidebar/composer 的 harness 细节对齐、Trajectory 从右栏面板
迁入中央 tab、以及轨迹工具栏（Duration/Turns/Calls + 分段条 + 角色徽章）。

## 三栏框架（src/layout/）

- 列常量与求解：`layout/columns.ts`（CENTER_MIN=400、SIDEBAR 264/280/420、
  AUTO_COLLAPSE=1024、RIGHTBAR 300/0.45/0.7）。语义：右栏先缩、再失轨，
  中央才让位；侧栏不让位。
- `layout/useFrameLayout.ts`：视口 ResizeObserver 测量 + localStorage 持久化
  （键 `harness.sidebar`/`harness.rightbar`，清除键 = 恢复默认）；窄视口
  (<1024) 自动收 56px 图标栏，可手动展开（drawer 断点与 AUTO_COLLAPSE 对齐：
  <1024 时 ☰ 打开浮层侧栏，中间档不会出现"挤压且无入口"）。
- `layout/AppFrame.tsx`：grid 三列 + DragHandle（pointer capture + rAF，
  拖拽基线 = 按下时刻渲染宽度，防 clamp 回跳）。

## 侧栏（src/components/shell/Sidebar.tsx）

自上而下（task09 Task 1 对齐 harness）：

- 品牌行：`Research Deep Agent` + `AGENT` 角标（`sidebar__brand-tag`），
  抽屉态（<1024）带 × 关闭钮。
- `⊕ New Session` 按钮 → `stream.openThread(undefined)` 开新会话。
- Workspaces 区头：标题 + 三个装饰性图标钮（⌕/▤/⊞，disabled 占位）。
- 会话列表 `sidebar__list`：**唯一滚动区域**——`.frame__sidebar` 设
  `overflow: hidden`，列表自身 `overflow-y: auto`，footer 不随内容推出视口。
- 底部 footer（钉底）：头像占位 `L` + `local-user` + Appearance 按钮
  （打开 ThemeSettingsDialog）。

样式约束：本仓库无全局 `box-sizing`（content-box）；侧栏内定宽元素必须
`box-sizing: border-box`，否则 `100%` 宽 + padding 会溢出网格单元、被
`.frame__sidebar` 的 overflow:hidden 裁掉 footer（task09 final fix）。

## Composer（src/components/composer/Composer.tsx）

卡片式（`composer-card`，task09 Task 2）：

- 自增高 textarea（Enter 发送 / Shift+Enter 换行，8 行封顶）。
- 底行：`＋` attach 钮（装饰性 disabled，title 提示暂不支持）、
  `⚙ Workspace Write` chip（装饰）、右侧模型标签 `{MODEL_NAME} High ▾`
  （`VITE_MODEL_NAME` 环境变量覆盖，默认 `gpt-4.1-mini`）、圆形发送钮
  （`↑`；流式进行中变 `■` stop）。
- 统计行 `⏱ N turns M steps`：App 由 `deriveTrajectory(stream.messages)`
  派生传入；**空会话不渲染**（`turns.length > 0` 才传 stats）。

## 中央 Chat|Trajectory tab（src/App.tsx，task09 Task 3）

Trajectory 入口从右栏面板迁入中央列顶部的 `center-tabs`（Header 已移除，task10）
（Chat / Trajectory 两个 tab，组件 state 不持久化，默认 Chat）。
右栏只剩 Sub-agents + Workbench（见下）。中央区结构：
tabs（Chat：MessageList/ActivityCard ‖ Trajectory：TrajectoryView）
→ Composer 恒在底部。

## 右栏面板域（src/panels/）

- `PanelHost`：tab 注册表（subagents / workbench；trajectory id 已在 task09
  final 移除——`PanelId = "subagents" | "workbench"`，持久化键 `harness.panel`
  里遗留的 `"trajectory"` 读取时降级为 null（无面板），类型上如实反映）。
  再次点击当前 tab 收起右栏；轨道收起时呈右缘 rail affordance，rail 里点击
  只激活（打开轨道）。
- 子 agent 面板：数据源 = 父图 state `async_tasks`（deepagents
  AsyncSubAgentMiddleware；task_id == thread_id）。任务转 running 时自动打开
  右栏并激活对应 tab（每任务一次）；tab 体 = `useSubagentStream`
  (`assistantId: "sdd-agent"`, 懒连接) 的只读消息流。
- workbench：TodoDock 迁入。审批不走面板——居中模态 `ApprovalDialog`
  （task11）：遮罩 + 卡片，respond 门禁 = 快捷卡「同意，继续下一阶段」
  （点中填入输入框，可再编辑）+ 自由输入；敏感工具 = 批准/拒绝选择卡
  （拒绝需理由）；多动作分页 ‹1/N› 逐个作答，底部统一「提交」按
  actionRequests 顺序组装 decisions（`submitApproval` 契约不变）。
  审批契约（未决禁用 composer、提交失败清空作答）不变。

## Trajectory（src/trajectory/）

### 组合视图 `TrajectoryView`（task09 Task 4）

tabs 下方工具栏 = 左侧三 toggle 开关钮（参照 TrajectoryToolbar 语义，非
行过滤器）+ 右侧搜索框（3s 节流索引）：

- **Duration**（默认按下，`aria-pressed`）：下方堆叠分段条常驻，每 step
  一段；按下 → 按 recorded duration 定宽，取消 → 全部等宽
  （title 在 "Use equal widths" / "Use actual durations" 间翻转）。
  - 段色：蓝 `duration-bar__seg--model` = 纯模型步；绿
    `duration-bar__seg--tools` = 含 tool 调用的 step。
  - 有真实时间戳（仅实时流捕获，见 Timeline 条目）且按下时按
    `durationMs` 占比分宽；无时间戳退化为序数等分（同一等宽公式）。
  - 末 step 无结束点 → 以其余 step 的均值宽度近似（`averageMs` 回退）。
  - hover title：`Step N … 1.2s`（formatDuration，≥1s 用 s，否则 ms）。
- **Turns**：全部 turn 折叠/展开开关（`aria-pressed` = 全折叠态，icon
  ⊟/⊞，title "Collapse turns"/"Expand turns"）；折叠后仅剩 turn 头行。
- **Calls**：全部 tool call 行折叠/展开开关（折叠 assistant 行为 summary，
  tool 行隐藏；title "Collapse calls"/"Expand calls"）。
- 折叠状态（`collapsedTurns`/`collapsedAssistants`）由 TrajectoryView 持有
  并受控传入 Ledger（原 ledger__controls 全部开合按钮与 tokens 统计移除，
  工具栏拥有该职责）；行内 turn 头点击仍可单开合（onToggleTurn 回调）。
- turn 头行 / tool 行 / 角色徽章始终渲染：`USER` / `AI` / `TOOL` /
  `T{turn}`（turn 头）。

Timeline 组件不再挂载——其模式语义并入 Duration 开关 + 分段条
（组件保留导出与组件级测试）；分段数据沿用 buildTimeline。

### 数据层

- 派生 `layout.ts`：messages → turn（human 开新 turn）→ step（AI 消息）→
  cell；task 工具结果包 `phase_report` 子块；usage 取 `usage_metadata`
  （input/output_tokens），模型取 `response_metadata.model_name`。
- Ledger `Ledger.tsx`：@tanstack/react-virtual 变高虚拟行；折叠（单 turn /
  全部 turn / 全部 assistant）；请求头（序号/模型/usage）；搜索命中
  `data-match`。容器高度 0（jsdom/SSR）时全量渲染兜底。
- Timeline `timeline.ts` + `lib/timestamps.ts`：时间戳 = 消息首见
  `Date.now()`（仅实时流有；线程打开时已存在的消息按历史处理不盖章），
  视图层经 `stepTimestampsFromMessages` 把 message id 捕获转成
  assistantKey 步级键后喂给 Timeline/分段条；历史回放 → 时间类派生退化
  为序数等分。
- 搜索 `search.ts`：小写分词索引，视图层 3s 节流重建。

## 已知降级（spec §6）

| 情况 | 行为 |
|---|---|
| `async_tasks` 缺失/空 | 子 agent 面板显示 "No async sub-agent tasks yet" |
| usage_metadata 缺失 | 请求头不显示 usage 列 |
| 历史回放（无时间戳） | Duration 分段退化为序数等分（不按耗时占比） |
| 末 step 无结束点 | 分段宽度按其余 step 的均值近似 |
| 持久化 `harness.panel="trajectory"`（task09 前旧值） | 读取降级为 null（无面板），下次激活面板即覆盖 |
| 子线程流错误 | tab 内错误条 + Retry，不影响主对话 |

## 故障排查

- 右栏宽度怪异：清 localStorage `harness.rightbar`（无键 = 首开 0.45 比例）。
- 子 agent tab 不自动弹出：确认后端 async 启动成功（父图 state 有
  `async_tasks` 且 status=running）；面板懒连接，tab 未激活不建流。
