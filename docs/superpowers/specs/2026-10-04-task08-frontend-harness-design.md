# task08 设计 Spec：deepseek-harness 风格前端 1:1 复刻（三栏框架 + 右栏面板域 + Trajectory 全套）

> 状态：待用户终审。参照仓库 `/home/zhang/workplace/deepseek-harness`
> （下称"参照项目"）的 web 前端，在 `frontend/` 自栈重写（React 18 +
> Vite + @langchain/langgraph-sdk，不搬参照代码）。分两期交付（方案 B）。
> 分支 `task08-frontend-harness`。

## 1. 背景与目标

当前 `frontend/` 约 1.2k 行：单列 shell + 抽屉式会话栏 +
MessageList/Composer/ApprovalDock/TodoDock/ToolCallCard，数据层为
LangGraph SDK `useStream`（主线程 assistantId `research`）。

用户三条需求与落点：

1. **任务期间对话框位置**：参照项目在子 agent 运行时把其对话以右侧栏
   tab 打开（`ui-subagent/src/client/sidebar-chat/index.tsx`），主对话
   留在中央列不被打断。本仓库对应：sdd-agent 异步任务运行时，右栏自动
   打开并激活该子线程的只读对话 tab。
2. **Trajectory 全部能力**：参照 `ui-trajectory`（约 13k 行）的
   Toolbar + Timeline + Ledger 三件套（搜索、折叠、时长模式、虚拟行、
   usage 请求头）。
3. **1:1 复刻相关页面**：布局与交互忠实还原参照页面，在我们自己的栈上
   重新实现（用户已确认，不移植 dockkit/slots 框架）。

成功标准：三栏框架的列求解/拖拽/持久化/窄视口行为与参照一致；右栏三
面板可切换且子 agent tab 随任务自动激活；Trajectory 四要素（派生、
Ledger、Timeline、Toolbar）可测可用。

## 2. 已核实的接口事实（设计依据）

### 2.1 参照项目（file:line 锚定）

- **列几何** `packages/client/ui-layout/src/client/columns.ts:11-29`：
  `CENTER_MIN=400`、`SIDEBAR_MIN=264`、`SIDEBAR_MAX=420`、
  `SIDEBAR_DEFAULT=280`、`SIDEBAR_COLLAPSED=56`、
  `SIDEBAR_AUTO_COLLAPSE=1024`、`RIGHTBAR_MIN=300`、
  `RIGHTBAR_DEFAULT_RATIO=0.45`、`RIGHTBAR_MAX_RATIO=0.7`；
  `computeColumns`（:52-59）：右栏先收缩、再失去轨道，之后中央才允许
  低于最小值；侧栏不参与让位。
- **三栏框架** `AppFrame.tsx`：grid 三列 + 两侧 DragHandle（pointer
  capture + rAF 节流，拖拽基线冻结在按下时刻的渲染宽度，:198-203）；
  右栏是"轨道"而非盒子——占位面板贴右缘绘制，轨道只决定中央是否让位
  （:63-70）；折叠/轨道翻转的 `data-animating` 过渡窗口（:205-241）；
  窄视口自动收侧栏（:178-179）。
- **右栏面板域** `ui-subagent/src/client/sidebar-chat/index.tsx`：子
  agent 会话以右侧栏 tab 打开（`sidebar.right.pane.tab`），tab 体为
  该子线程的只读 Conversation（`SubagentReadOnlyComposer`）。
- **Trajectory** `ui-trajectory/src/client/TrajectoryView.tsx`：
  - Toolbar：时长模式（序列/耗时/真实时间/关）、折叠全部 turn、折叠
    全部 assistant、搜索框（:510-530）；
  - Timeline：横向时间轴，选区/记录选中/聚焦与 Ledger 联动
    （:531-543）；
  - Ledger：turn 分组 + 请求头行（序号、provider/model、usage 累计、
    重试，:213-313）+ 工具块（含 subCalls 递归，:37-42）+ JSON 检查
    （折行偏好 :546-551）+ 分页加载（`HISTORY_PAGE_NODES=50`，:35）；
  - 搜索索引 3s 节流重建（`SEARCH_INDEX_THROTTLE_MS`，:34）；
  - 虚拟行：`@tanstack/react-virtual@^3.14.9`（package.json:70）+
    `trajectory-virtual-rows.ts`（请求边界行并入下一内容行，避免零高
    项，:48-80）。

### 2.2 本仓库（file:line 锚定当前 master 工作树）

- **子线程可达**：`deepagents/middleware/async_subagents.py:80-135`
  `AsyncTask{task_id（=thread_id）, thread_id, status, started_at,
  last_updated_at, ...}`，状态键 `async_tasks: dict[task_id, AsyncTask]`
  （:135）。前端从 `stream.values.async_tasks` 读取即可，无需后端改动。
- **usage/模型名**：`AIMessage.usage_metadata`（OpenAI 兼容网关有值，
  `langchain_core/messages/ai.py:176`）+ `response_metadata.model_name`。
- **无消息级时间戳**：LangGraph state 消息不携带 wall-clock 时间。
  Timeline 的耗时/真实时间模式需客户端实时捕获；历史回放降级序列模式。
- **同步子 agent 映射**：prd/bdd 的产出在父线程里是 `task` 工具的
  ToolMessage（response_format JSON），天然映射为 Trajectory 的嵌套
  subtool 块（与参照 ToolCallBlock.subCalls 语义一致）。
- **现状组件**：`frontend/src/App.tsx`（单列 shell）、
  `components/approval/ApprovalDock.tsx`（含渲染期错误复位决策）、
  `components/todo/TodoDock.tsx`、`lib/stream.ts`
  （`extractPendingApproval`/`submitApproval`，契约不变）。

## 3. 总体架构

```
frontend/src/
  layout/        ← 一期：三栏框架（AppFrame、columns 求解、DragHandle、持久化）
  panels/        ← 一期：右栏面板域（PanelHost、tab 注册表、子 agent tab）
  chat/          ← 一期：现有 chat/approval/todo/composer 组件迁入中央列
  trajectory/    ← 二期：layout 派生 / Ledger / Timeline / Toolbar / 搜索 / 虚拟行
  lib/stream.ts  ← 数据层不动 + 新增 useSubagentStream（懒连接）
```

- 新依赖仅 `@tanstack/react-virtual`（参照同款，MIT，支持变高行）。
- 样式沿用 `styles.css` 全局变量 + 新组件按文件就近 CSS modules 混用。
- 数据层不变：主线程 `useStream`（assistantId `research`）；子 agent
  tab 用独立 `useStream(assistantId: "sdd-agent", threadId)`。

## 4. 一期：三栏框架 + 右栏面板域

### 4.1 layout/

- `columns.ts`：常量与 `computeColumns` 逐字对齐参照语义（§2.1）。
- `AppFrame.tsx`：grid 三列；DragHandle 用 pointer capture + rAF 节流，
  拖拽基线 = 按下时刻渲染宽度（防 concession 回跳）；`data-animating`
  仅在折叠/轨道翻转时开启（transitionend + 600ms 兜底）。
- 持久化（localStorage）：侧栏宽度、右栏宽度、右栏激活 tab；窄视口
  （<1024）自动收侧栏为 56px 图标栏。

### 4.2 panels/（右栏面板域）

- `PanelHost`：tab 注册表（子 agent 对话 / Trajectory / Todos+审批）+
  tab 条 + 宽度轨道语义（无面板时轨道归零）。
- **子 agent 对话 tab**：数据源 `stream.values.async_tasks`；每个
  sdd 任务一个 tab（标题 = task_id 前缀 + status 徽标）；tab 体
  `useSubagentStream(threadId)` 渲染子线程消息流，只读无 composer
  （对齐参照 SubagentReadOnlyComposer）。**任务 status 变为 running
  时自动打开右栏并激活对应 tab；主对话留在中央**（任务期间对话框位置
  的落点）。懒连接：tab 激活才建立 useStream。
- **Todos + 审批 tab**：现有 TodoDock、ApprovalDock 迁入，审批卡
  置顶；composer 的未决禁用守卫与 `submitApproval` 契约不变。
- **Trajectory tab**：一期渲染空态占位，二期填充。

## 5. 二期：Trajectory 全套

### 5.1 数据派生（`trajectory/layout.ts`，纯函数）

父线程 messages → turn（每条 human 消息开新 turn）→ step（每条
AIMessage 一步）→ cell（assistant 文本块 / 工具块）；ToolMessage 按
`tool_call_id` 归入工具块；`task` 工具的 ToolMessage（prd/bdd 的
response_format JSON）渲染为嵌套 subtool 块；运行中的 partial
assistant 归入当前 step 的 cell。请求头取 `usage_metadata`（按 step
累计）与 `response_metadata.model_name`。

### 5.2 Ledger（表格）

turn 分组行 + 请求头行（序号、模型、usage、耗时）+ 工具块（JSON 检查
器、折行切换）+ 折叠（单 turn / 全部 turn / 全部 assistant，状态机同
参照 collapsedTurns/collapsedAssistants）；`@tanstack/react-virtual`
变高虚拟行，请求边界行并入下一内容行（参照 trajectory-virtual-rows
语义）。

### 5.3 Timeline（时间轴）

横向时间轴，四种模式：序列 / 耗时 / 真实时间 / 关。选区（range）过滤
与记录选中、聚焦双向联动 Ledger。时间戳客户端实时捕获（消息首次到达
`Date.now()`）；历史回放无时间戳 → 耗时/真实时间模式禁用并提示，
序列模式不受影响。

### 5.4 Toolbar

全文搜索（客户端分词索引、3s 节流重建、Ledger 命中高亮）+ 折叠全部
按钮组 + 模式切换。

## 6. 数据层与降级

- 子 agent tab 懒连接（激活才挂 useStream），卸载即断。
- `async_tasks` 缺失/为空 → 子 agent tab 区显示空态说明。
- usage 缺失（网关不给）→ 请求头隐藏 usage 列，不报错。
- 历史回放无时间戳 → Timeline 时间类模式禁用（§5.3）。

## 7. 错误处理

- 子线程 stream 出错 → tab 内错误条 + 重试按钮，不影响主对话。
- 右栏面板抛错 → React error boundary 包裹单面板，崩溃不拖垮框架。
- 窄视口（<1024）自动收侧栏、右栏优先保活（参照挤压顺序）。

## 8. 测试设计（vitest jsdom，沿用现有风格）

| 域 | 用例 |
|---|---|
| columns | computeColumns 纯函数边界：右栏先缩后失轨、中央保护、clamp、auto-collapse |
| AppFrame | 拖拽手柄宽度更新（pointer capture 模拟）、持久化恢复、窄视口折叠 |
| panels | tab 注册/切换/持久化；async_tasks → 子 agent tab 生成与 running 自动激活 |
| useSubagentStream | 懒连接（激活才建）、卸载即断、错误条重试 |
| trajectory/layout | messages→turn/step/cell 派生：task subtool 嵌套、partial 归属、usage 累计 |
| trajectory/UI | 搜索命中高亮、折叠状态机、timeline 选区联动、虚拟行窗口 |
| 集成 | ApprovalDock 迁入右栏后既有审批测试仍过（移动不改契约） |

## 9. 明确不做（defer）

- dockkit 面板引擎（pane 树拖拽重排、多面板分屏）；多会话右侧栏；
- 图片附件画廊（`conversation.trajectory.images`）；compaction 节点
  （本仓库无该机制）；
- 移动端专门布局（仅保证不崩）；触控优化；
- 后端时间戳注入（Timeline 时间模式先客户端捕获，后端方案另立项）。

## 10. 范围外备注（不在本任务处理）

- `agent.py:323-325` 的 `return _cap_recursion(graph)` 为死代码
  （cc671e0 遗留，引用未定义名 `graph`，实际不可达）——属后端，不在
  前端任务范围，待用户接线决定。
- `fix/async-launch-http-url` 分支（0015070+5ef046b）尚未合并，等
  用户实测确认后合并；本任务分支从 master 切出，不含该修复。

## 11. 自审清单

- 占位符：无 TBD；时间戳缺失、usage 缺失、async_tasks 缺失的降级均已
  写明（§6）。
- 一致性：§4.2 子 agent 自动激活与用户需求 1 对应；§5 与参照能力清单
  逐项对齐；§8 测试覆盖 §5 全部交付面。
- 范围：两期各约 3-4 个实施任务，单计划可承载。
- 歧义：`task` 工具的 ToolMessage 判定 = 工具名为 `task`（sync 子
  agent 委派），已写明；"running 自动激活"以 AsyncTask.status 为准。

## 12. 风险与边界

| 风险 | 缓解 |
|---|---|
| `async_tasks` 只含 sdd 任务（prd/bdd 是同步委派） | 子 agent tab 语义即"异步任务"；同步委派在 Trajectory 以 subtool 块呈现（§5.1），两者不重叠 |
| 虚拟行 + 流式 partial 高频重排性能 | 参照同款 react-virtual；partial 仅追加当前 cell，行数不变时不重算窗口 |
| useStream 双实例（主 + 子）状态膨胀 | 子 agent tab 懒连接 + 卸载即断（§6）；同屏最多一个激活子 tab |
| 参照交互细节（动画窗口、基线冻结）遗漏 | columns/AppFrame 语义逐条对照 §2.1 锚点实现，测试逐条对应 |
