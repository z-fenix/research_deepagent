# 前端 harness 框架与 Trajectory（task08）

参照 `deepseek-harness` web 前端 1:1 复刻的布局与轨迹能力（自栈重写）。

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

## 右栏面板域（src/panels/）

- `PanelHost`：tab 注册表（subagents / trajectory / workbench），激活态持久化
  （键 `harness.panel`）；再次点击当前 tab 收起右栏。
- 子 agent 面板：数据源 = 父图 state `async_tasks`（deepagents
  AsyncSubAgentMiddleware；task_id == thread_id）。任务转 running 时自动打开
  右栏并激活对应 tab（每任务一次）；tab 体 = `useSubagentStream`
  (`assistantId: "sdd-agent"`, 懒连接) 的只读消息流。
- workbench：ApprovalDock + TodoDock 迁入；审批契约（未决禁用 composer、
  决策复位）不变。

## Trajectory（src/trajectory/）

- 派生 `layout.ts`：messages → turn（human 开新 turn）→ step（AI 消息）→
  cell；task 工具结果包 `phase_report` 子块；usage 取 `usage_metadata`
  （input/output_tokens），模型取 `response_metadata.model_name`。
- Ledger `Ledger.tsx`：@tanstack/react-virtual 变高虚拟行；折叠（单 turn /
  全部 turn / 全部 assistant）；请求头（序号/模型/usage）；搜索命中
  `data-match`。容器高度 0（jsdom/SSR）时全量渲染兜底。
- Timeline `timeline.ts` + `lib/timestamps.ts`：序列/耗时/真实时间/关 四模式；
  时间戳 = 消息首见 `Date.now()`（仅实时流有；线程打开时已存在的消息按历史
  处理不盖章），视图层经 `stepTimestampsFromMessages` 把 message id 捕获
  转成 assistantKey 步级键后喂给 Timeline；历史回放 → 时间类模式禁用。
- 搜索 `search.ts`：小写分词索引，视图层 3s 节流重建。

## 已知降级（spec §6）

| 情况 | 行为 |
|---|---|
| `async_tasks` 缺失/空 | 子 agent 面板显示 "No async sub-agent tasks yet" |
| usage_metadata 缺失 | 请求头不显示 usage 列 |
| 历史回放（无时间戳） | Timeline duration/actual 禁用 + title 提示 |
| 子线程流错误 | tab 内错误条 + Retry，不影响主对话 |

## 故障排查

- 右栏宽度怪异：清 localStorage `harness.rightbar`（无键 = 首开 0.45 比例）。
- 子 agent tab 不自动弹出：确认后端 async 启动成功（父图 state 有
  `async_tasks` 且 status=running）；面板懒连接，tab 未激活不建流。
